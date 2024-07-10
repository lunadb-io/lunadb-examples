# LunaDB Example Applications

This repo is a collection of example applications that use LunaDB. You can run the project by executing `npm run serve`, which will automatically build the javascript and spin up an Express server.

## Examples

### Collaborative CodeMirror Editor

- URL: http://localhost:3000/app/markdown.html

A straight-forward CodeMirror editor that uses LunaDB as its central authority. Each client synchronizes with LunaDB every two seconds, and uses CodeMirror's existing functionality to provide rebasing of local, unsubmitted changes.
