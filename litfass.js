const puppeteer = require('puppeteer');

const nbind = require('nbind');
const Display = nbind.init().lib.Display;
const sleep = time => new Promise(resolve => setTimeout(resolve, time));

const config = require('config').get('litfass');
const { scheduleIn } = require('./schedule');

const LAUNCH_TIMEOUT = 10e3, DEFAULT_ROTATION_SPEED = 5e3, DEFAULT_TRANSITION_ANIMATION = {
    name: 'fade',
    duration: 200
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

exports.start = async (app) => {
    const displays = Display.getDisplays(), pages = [];

    // launch one browser per display
    for (const display of displays) {
        const browser = await puppeteer.launch({
            headless: false,
            defaultViewport: null, /* do not set any viewport => full screen */
            args: [
                '--kiosk' /* launch in full-screen */,
                `--app=${app}`, /* needed to get rid of "automation" banner */
                `--window-position=${display.left},${display.top}`
            ]
        });
    
        // remember the page objects, we'll need them later on
        let page; pages.push(page = (await browser.pages())[0]);


        // if all pages / browser have been closed, exit litfaß
        function closeDisplay(display) {
            display.closed = true;
            if(!displays.some(display => !display.closed)) {
                // all displays have been closed, exit the process
                process.exit(0);
            }
        }
        browser.on('disconnected', () => closeDisplay(display));
        page.on('close', () => closeDisplay(display));
    }
    
    // wait on the launch screen until the launch timeout has passed
    await sleep(LAUNCH_TIMEOUT);

    // for each display start the rotation
    await Promise.all(displays.map(async (nothing, index) => {
        const page = pages[index], display = Object.assign({}, config[index] || config[0], { currentPage: -1 });

        // check if the display has a pages array
        if (!Array.isArray(display.pages)) {
            throw new Error(`Display ${index} needs a 'pages' array`);
        } else if(!display.pages.length) {
            throw new Error(`Display ${index} needs at least one page to display`);
        } else if(display.ignore) {
            // ignore this display for the litfaß display
            return;
        }

        // normalize the rotationSpeed to an array of integer numbers
        if (!display.rotationSpeed || !Array.isArray(display.rotationSpeed)) {
            display.rotationSpeed = Array(display.pages.length).fill(
                (display.rotationSpeed | 0) || DEFAULT_ROTATION_SPEED);
        } else {
            display.rotationSpeed = Array.from(Array(display.pages.length), (nothing, page) =>
                (display.rotationSpeed[page] | 0) || DEFAULT_ROTATION_SPEED);
        }

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
        }

        // function to advance to the next page
        async function advancePage() {
            display.currentPage = ++display.currentPage % display.pages.length;

            if (!page.isClosed() && display.pages.length > 1) {
                // we have a very flaky schedule in place, thus this call will always try to merge
                // multiple events into one. this way all the displays will stay nicely in sync!
                scheduleIn(display.rotationSpeed[display.currentPage], advancePage);
            }

            try {
                if (transitionAnimation.name !== 'none') {
                    // in case a transition should be made fade out first
                    await page.addStyleTag({ content: transitionAnimation.out });
                    await sleep(transitionAnimation.halfDuration);

                    // do NOT await the page to be advanced (maybe it takes longer than the next timeout)
                    await page.goto(display.pages[display.currentPage], { waitUntil: 'domcontentloaded' });
                    await page.addStyleTag({ content: transitionAnimation.after });
                    await page.addStyleTag({ content: transitionAnimation.in });
                } else {
                    // with no transition, navigate immediately
                    await page.goto(display.pages[display.currentPage]);
                }
            } catch(e) {
                // nothing to do here, likely the page has been closed!
                console.warn(`Display ${index} navigation failed`);
            }
        }

        // advance to the first page and schedule the rotation
        advancePage();
    }));
};