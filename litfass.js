"use strict";

const puppeteer = require('puppeteer');

const nbind = require('nbind');
const Display = nbind.init(__dirname).lib.Display;

process.env["NODE_CONFIG_DIR"] = __dirname + "/config/";
const { sleep, scheduleIn } = require('./schedule');

const merge = require('deepmerge')

const silentImmediate = (asyncCallback, errorCallback) => {
    setImmediate(async () => {
        try { await asyncCallback(); } 
        catch(error) {
            // catch any errors (silently)
            if (errorCallback) {
                errorCallback(error);
            }
        }
    })
};

const DEFAULT_LAUNCH_TIMEOUT = 10, DEFAULT_PREPARATION_TIME = 5, DEFAULT_AIR_TIME = 10, DEFAULT_TRANSITION_ANIMATION = {
    name: 'fade',
    duration: 400
}, TRANSITION_ANIMATIONS = {
    none: null,
    fade: {
        out: 'opacity: 0; transition: opacity @durationms ease-in;',
        after: 'opacity: 0;',
        in: 'opacity: 1; transition: opacity @durationms ease-out;'
    },
    slideUp: {
        out: 'transform: translateY(-100%); transition: transform @durationms ease-in;',
        after: 'transform: translateY(100%);',
        in: 'transform: translateY(0); transition: transform @durationms ease-out;'
    },
    slideLeft: {
        out: 'transform: translateX(-100%); transition: transform @durationms ease-in;',
        after: 'transform: translateX(100%);',
        in: 'transform: translateX(0); transition: transform @durationms ease-out;'
    }
};

const animate = (page, ...animations) => {
    return new Promise((resolve, reject) => {
        silentImmediate(async () => {
            for(const animation of animations) {
                if (typeof animation === "string") {
                    await page.addStyleTag({ content: animation });
                } else if (animation) {
                    await animation(page);
                }
            } resolve();
        }, reject);
    }).catch(error => { /* do nothing */ });
};

exports.start = async (app) => {
    // read the configuration and create a deep copy
    const config = merge.all([require('config').get('litfass') || {}]);

    // normalize the configuration
    config.launchTimeout = ((config.launchTimeout | 0) || DEFAULT_LAUNCH_TIMEOUT) * 1e3; // normalize to milliseconds
    config.preparePages = 'preparePages' in config ? config.preparePages : true; // by default prepare one page in advance
    config.preparationTime = Math.max(( config.preparationTime | 0 ) || DEFAULT_PREPARATION_TIME, 0) * 1e3; // normalize to milliseconds

    // check if there is at least one display defined
    if (!Array.isArray(config.displays)) {
        throw new Error(`Litfaß needs a 'displays' array`);
    } else if(!config.displays.length) {
        throw new Error(`Litfaß needs at least one display configured`);
    }

    // create browsers for each display
    const displays = Display.getDisplays();
    await Promise.all(displays.map(async (display, index) => {
        // normalize the configuration for this display
        Object.assign(display, config.displays[index] || config.displays[0], {
            launch: true, currentPage: -1, currentTab: -1 });

        // check if this display should be ignored by litfaß
        if(display.ignore) {
            return;
        }
        
        // check if the display has a pages array
        if (!Array.isArray(display.pages)) {
            throw new Error(`Display ${index} needs a 'pages' array`);
        } else if(!display.pages.length) {
            throw new Error(`Display ${index} needs at least one page to display`);
        }

        // normalize the rotationSpeed and URL into an array of page objects
        display.pages = display.pages.map((url, index) => ({
            url, airTime: ((Array.isArray(display.rotationSpeed) ?
                (display.rotationSpeed[index] | 0) : (display.rotationSpeed | 0))
                    || DEFAULT_AIR_TIME) * 1e3 // normalize to milliseconds
        }));

        // normalize the transitionAnimation to an object
        if (!display.transitionAnimation || typeof display.transitionAnimation !== 'object') {
            display.transitionAnimation = { name: display.transitionAnimation };
        }
        const transitionAnimation = display.transitionAnimation = {
            name: display.transitionAnimation.name || DEFAULT_TRANSITION_ANIMATION.name,
            duration: (display.transitionAnimation.duration | 0) || DEFAULT_TRANSITION_ANIMATION.duration
        };

        // check if a valid transition was specified and replace the durations
        if (!(transitionAnimation.name in TRANSITION_ANIMATIONS)) {
            throw new Error(`Display ${index} has an unknown transition animation '${transitionAnimation.name}'`);
        } else if(transitionAnimation.name !== 'none') {
            transitionAnimation.halfDuration = (transitionAnimation.duration / 2) | 0;
            for (const key of ['in', 'after', 'out']) {
                transitionAnimation[key] = `html { ${ TRANSITION_ANIMATIONS[transitionAnimation.name][key]
                    .replace('@duration', transitionAnimation.halfDuration) } }`
            }
        } else {
            // no animation takes no time to animate
            transitionAnimation.halfDuration = 0;
        }

        // launch one browser per display
        const browser = display.browser = await puppeteer.launch(merge.all([config.browserOptions, display.browserOptions, {
            headless: false,
            defaultViewport: null, /* do not set any viewport => full screen */
            ignoreDefaultArgs: ['--enable-automation'],
            args: [
                '--kiosk' /* launch in full-screen */,
                `--window-position=${display.left},${display.top}`
            ]
        }]));

        // if all displays have been closed, exit litfaß
        async function closeDisplay() {
            // if the browser is still connected, close it (as only one page was closed)
            if (browser.isConnected()) {
                await browser.close();
            }

            display.closed = true;
            if(!displays.some(display => !display.closed)) {
                // all displays have been closed, exit the process
                process.exit(0);
            }
        } browser.on('disconnected', closeDisplay);
        
        // the browser will open with one page pre-loaded
        const firstTab = (await browser.pages())[0];
        await firstTab.goto(app); // passed in by ./bin/www

        // open more pages (tabs) for preparing pages before rotation
        const additionalTabs = await Promise.all(Array.from({
            length: config.preparePages | 0 // will work with positive numbers and booleans where true maps to 1
        }, async () => {
            // open the page and jump back to the launch screen immediately    
            let page = await browser.newPage();
            await firstTab.bringToFront();
            return page;
        }));

        // if any page was closed, close the browser for this display
        (display.tabs = [firstTab, ...additionalTabs])
            .forEach(page => page.on('close', closeDisplay));
    }));

    // start the rotation for each display
    await Promise.all(displays.map(async (display, index) => { for(const transitionAnimation = display.transitionAnimation;;) {
        // check if the browser for this display is still connected
        if (display.ignore || !display.browser.isConnected()) {
            break; // if not exit the rotation for this display
        }

        // increment the current page count and get the current / next page object to display
        const page = display.launch ? { airTime: config.launchTimeout } :
            display.pages[display.currentPage = ++display.currentPage % display.pages.length],
          nextPage = display.pages[(display.currentPage + 1) % display.pages.length];
        delete display.launch; // on the first iteration displaying the launch page will NOT increment the page count

        // also get the currently active and next in line browser tab to use
        const tab = display.tabs[display.currentTab = ++display.currentTab % display.tabs.length],
          nextTab = display.tabs[(display.currentTab + 1) % display.tabs.length];
        const loadNextTab = wait => animate(nextTab, wait ? () => sleep(wait) : null, () => 
            nextTab.goto(nextPage.url, { waitUntil: 'domcontentloaded' }), transitionAnimation.after);
        
        // if pages should be prepared, load the next tab already shortly before we switch to it
        config.preparePages && loadNextTab(page.airTime - config.preparationTime);

        // all displays that are scheduled to show a page at the same time, should be doing so as synchronized as possible, so use a flaky scheduler here
        await scheduleIn(page.airTime, async () => {
            animate(tab, transitionAnimation.out);
            await sleep(transitionAnimation.halfDuration); // wait here, as the offset was subtracted from the schedule time before
            animate(nextTab, () => config.preparePages ? nextTab.bringToFront() : loadNextTab(), transitionAnimation.in, config.preparePages ? () => tab.goto('about:blank') : null);
        }, -transitionAnimation.halfDuration /* offset, so we stay as close to the air time as possible */);
    }}));
};