[<img width="300" alt="Litfaß Logo" src="https://raw.githubusercontent.com/kristian/litfass/master/public/img/litfass.svg?sanitize=true">](https://github.com/kristian/litfass)

A browser-based digital advertising column / display / pole / poster / kiosk with support for multiple displays. Use a `default.yaml` configuration file in a `./config` folder to define pages and Litfaß will present them in rotation on all connected displays.

The name of this library was inspired by the German name of advertising columns "*Litfaßsäule*" and its inventor [Ernst Litfaß](https://en.wikipedia.org/wiki/Ernst_Litfa%C3%9F).

## Installation

This is a [Node.js](https://nodejs.org/en/) module available through the
[npm registry](https://www.npmjs.com/).

Before installing, [download and install Node.js](https://nodejs.org/en/download/).
Node.js 12 is recommended.

**Important Note:** An own native module ([displays.cc](displays.cc)) is used to determine all connected displays and their display coordinates, in order to start the browsers on each display. This module is currently *only* available for Windows. Thus this module will likely fail to install on any other OS! Please feel free to contribute and issue a PR on GitHub anytime.

To run Litfaß, use the npx command:

```bash
$ npm install -g npx litfass
$ npx litfass start
```

## Configuration

To configure the Litfaß display, go to the `node_modules/litfass` folder. In case you installed Litfaß globally, use the following command to locate the right directory:

```bash
$ npm root -g
```

In the `litfass` directory you'll find a `/config` sub-folder containing a `default.yaml` configuration file. The configuration is explained in the YAML file. Check out the [config package](https://www.npmjs.com/package/config) for more details on the configuration formats supported.

The following settings are available in the configuration file:

- **displays**: An array of displays, to specify different rotations on different displays connected. In case more displays are connected than specified here, the first display configuration will be used.
    - *pages*: An array of URLs to rotate the display between (e.g. https://example.com and https://kra.lc/ will rotate between those two pages in the set `rotationSpeed`)
    - *rotationSpeed*: The number of seconds each page should be displayed. In case some pages should be displayed longer than others, you can also specify an array. By default a page is displayed for 10 seconds before being rotated.
    - *transitionAnimation*: Litfaß supports transitioning between multiple pages when rotating. The following animations are supported `none`, `fade`, `slideUp`, `slideLeft`, defaults to `fade`. You can also use an object `{ name: ..., duration: ... }` to specify the speed of the transition in milliseconds.
    - *ignore*: If set Litfaß will ignore this display and will not start a browser on the specified display.
- **launchTimeout**: The number of seconds Litfaß will display its slash / launch screen.
- **browserOptions**: Options that will be merged into the launch options for Puppeteer / Chrome, e.g. handy in case you would like to specify an own *executablePath* for Chrome. *browserOptions* can also be set per display in the displays configuration.
- **preparePages**: Litfaß will automatically attempt to prepare any page, before it is displayed. This setting can be used to specify if Litfaß should prepare the pages (`true` / `false`) and / or the number of pages to prepare in advance. The setting **preparationTime** will determine how much in advance Litfaß is going to attempt to load the next tab (default to 5 seconds).
- **watchNumberOfDisplays**: Litfaß will automatically watch for the number of displays connected. In case the number of display changes, Litfaß will restart and show browsers on the newly connected displays. Can be turned off by setting this property to `false`.

By default the `displays` configuration section contains only one element. This causes the same rotation of pages to be displayed on all connected displays. Define multiple entries in the `displays` section, where each entry corresponds to one display connected. To ignore a display use `ignore: true`.

## Author

Written by [Kristian Kraljić](https://kra.lc/).

## Reporting bugs

Please file any issues [on Github](https://github.com/kristian/litfass).

## License

This library is licensed under the [MIT](LICENSE) license.