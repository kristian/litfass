"use strict";

const { EventEmitter } = require('events');

const puppeteer = require('puppeteer');
const getDisplays = require('displays');

const Scheduler = require('./scheduler');
const merge = require('deepmerge')

const DEFAULT_LAUNCH_TIMEOUT = 10, DEFAULT_PREPARATION_TIME = 5, DEFAULT_AIR_TIME = 10, DEFAULT_TRANSITION_ANIMATION = {
    name: 'fade',
    duration: 400
}, WATCH_DISPLAYS_TIMEOUT = 10 * 1e3 /* every 10 seconds */, TRANSITION_ANIMATIONS = {
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

module.exports = new (class Litfass extends EventEmitter {
    displays = [] // an array of displays after litfass was started

    async start(settings) {
        const displays = this.displays;
        if (displays.length) {
            throw new Error(`Litfaß is already running`);
        } else if (!(this.settings = settings).ignoreConfiguration) {
            process.env.SUPPRESS_NO_CONFIG_WARNING = true;
            const config = require('config');
    
            // read & resolve the configuration and create a deep copy
            config.util.setModuleDefaults('litfass', settings);
            settings = merge.all([(await (require('config/async')
                .resolveAsyncConfigs(config))).get('litfass') || {}]);
        }
    
        // normalize the settings
        settings.launchTimeout = ((settings.launchTimeout | 0) || DEFAULT_LAUNCH_TIMEOUT) * 1e3; // normalize to milliseconds
        settings.preparePages = 'preparePages' in settings ? settings.preparePages : true; // by default prepare one page in advance
        settings.preparationTime = Math.max(( settings.preparationTime | 0 ) || DEFAULT_PREPARATION_TIME, 0) * 1e3; // normalize to milliseconds
        settings.watchDisplays = 'watchDisplays' in settings ? !!settings.watchDisplays : true; // detect if the number of displays has changes (both physical, or if a browser was closed)
    
        // check if there is at least one display defined
        if (!Array.isArray(settings.displays)) {
            throw new Error(`Litfaß needs a 'displays' array`);
        } else if(!settings.displays.length) {
            throw new Error(`Litfaß needs at least one display configured`);
        }
    
        // create a scheduler, which can be closed when litfaß exists
        const scheduler = this.scheduler = new Scheduler(), sleep = scheduler.sleep.bind(scheduler);
    
        // get all displays and sort them from top to bottom, left to right
        displays.splice(0, Number.MAX_SAFE_INTEGER, ...getDisplays().sort((displayA, displayB) =>
            displayA.top - displayB.top || displayA.left - displayB.left));

        // create browsers for each display
        await Promise.all(displays.map(async (display, index) => {
            // normalize the settings for this display
            Object.assign(display, settings.displays[index] || settings.displays[0], {
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
            const browser = display.browser = await puppeteer.launch(merge.all([settings.browserOptions || {}, display.browserOptions || {}, {
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
                    return; // we'll be called again by the disconnected event
                }
    
                // if a browser was closed remove the display from the displays array
                displays.splice(displays.indexOf(display), 1);

                // as soon as all displays have been closed, stop any open schedules / sleep timers
                // this causes the original start promise to resolve if we are not restarting. in case
                // of a restart, the restart scheduler is currently not in a "sleep", so the  interrupt
                // will not cause the restart loop to exit and the start function will be triggered
                if(!displays.length) {
                    scheduler.close();
                    delete this.scheduler;
                }
            } browser.on('disconnected', closeDisplay);
            
            // the browser will open with one page pre-loaded
            const firstTab = (await browser.pages())[0];
            await firstTab.goto(settings.launchUrl || 'about:blank');
    
            // open more pages (tabs) for preparing pages before rotation
            const additionalTabs = await Promise.all(Array.from({
                length: settings.preparePages | 0 // will work with positive numbers and booleans where true maps to 1
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
    
        // emit a start event, after all browsers have been launched
        this.emit('browsersLaunch', displays);

        // start the rotation for each display
        const rotations = displays.map(async (display, index) => {
            for(const transitionAnimation = display.transitionAnimation;;) {
                // check if the browser for this display is still connected
                if (display.ignore || !display.browser.isConnected()) {
                    break; // if not exit the rotation for this display
                }
    
                // increment the current page count and get the current / next page object to display
                const page = display.launch ? { airTime: settings.launchTimeout } :
                    display.pages[display.currentPage = ++display.currentPage % display.pages.length],
                nextPage = display.pages[(display.currentPage + 1) % display.pages.length];
                delete display.launch; // on the first iteration displaying the launch page will NOT increment the page count
    
                // also get the currently active and next in line browser tab to use
                const tab = display.tabs[display.currentTab = ++display.currentTab % display.tabs.length],
                nextTab = display.tabs[(display.currentTab + 1) % display.tabs.length];
                const loadNextTab = wait => animate(nextTab, wait ? () => sleep(wait) : null, async () => {
                    await nextTab.goto(nextPage.url, { waitUntil: 'domcontentloaded' });
                    this.emit('pageLoad', nextTab, display);
                }, transitionAnimation.after);
                
                // if pages should be prepared, load the next tab already shortly before we switch to it
                settings.preparePages && loadNextTab(page.airTime - settings.preparationTime);
    
                // all displays that are scheduled to show a page at the same time, should be doing so as synchronized as possible, so use a flaky scheduler here
                await scheduler.scheduleIn(page.airTime, async () => {
                    animate(tab, transitionAnimation.out);
                    await sleep(transitionAnimation.halfDuration); // wait here, as the offset was subtracted from the schedule time before
                    animate(nextTab, async () => {
                        await (settings.preparePages ? nextTab.bringToFront() : loadNextTab());
                        this.emit('pageShow', nextTab, display);
                    }, transitionAnimation.in, settings.preparePages ? () => tab.goto('about:blank') : null);
                }, -transitionAnimation.halfDuration /* offset, so we stay as close to the air time as possible */);
            }
        }).map(promise => promise.catch(() => undefined)); // do not consider it a problem if any single display fails, just resolve the promise!
    
        // regularly check if the number of displays has changed, this is especially helpful, e.g.
        // in case some displays are turned off in the afternoon and turned on again in the morning
        await Promise.all([...rotations, settings.watchDisplays ? (async () => {
            for(;;) {
                try {
                    await sleep(WATCH_DISPLAYS_TIMEOUT);
                } catch(interrupt) {
                    return; // in case the sleep was interrupted, the scheduler was closed!
                }
    
                // in case displays have been attached / detached, exit the loop, we'll start a new one soon!
                if (this.watchRestart || displays.length !== getDisplays().length) {
                    delete this.watchRestart;
                    break;
                }
            }
        
            // in case a change in the number of displays was detected, restart litfaß either because 
            // a physical display was connected / disconnected, or a browser window was closed
            await this.restart();
        })() : null]);
    }

    async restart(inWatcher) {
        if (inWatcher) {
            // this will cause litfaß to restart the next time it'll check for display changes
            // with the added benefit of keeping the original promise chain going
            this.watchRestart = true;
        } else {
            // restart litfaß by exiting and adding another "start" promise to the chain
            await this.exit(); await this.start(this.settings);
        }
    }

    async exit() {
        await Promise.all(this.displays.map(display => display.browser.close()));
    }
})();