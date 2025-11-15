# Getting Started With Google Chrome Extensions (Hello World)

This example demonstrates how to create a simple "Hello World" Chrome Extension.
For more details, visit the [official tutorial](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world).

## Running This Extension

1. Clone this repository.
2. Load this directory in Chrome as an [unpacked extension](https://developer.chrome.com/docs/extensions/mv3/getstarted/development-basics/#load-unpacked).
3. Click the extension icon in the Chrome toolbar, then select the "Hello Extensions" extension. A popup will appear displaying the text "Hello Extensions".

## Elements for building the extension

### Manifest

It defines the name, icon and all the popups, background script, actions, and the permissions that our extension requires

### .html files

The UI content of the popup - simple HTML website

### popup.js

Script that only runs when the popup is opened.

### Background scripts

They run when the extension is closed, doing all the required processes

###
