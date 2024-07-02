import {EditorView, basicSetup} from "codemirror"
import {ViewPlugin} from "@codemirror/view"
import {ChangeSet} from "@codemirror/state"
import {markdown} from "@codemirror/lang-markdown"
import { DocumentTransaction } from "@lunadb-io/lunadb-client-js";

function syncExtension(initialVersion) {
    let plugin = ViewPlugin.fromClass(class {
        clientId = crypto.randomUUID()
        version = initialVersion
        destroyed = false
        syncing = false

        constructor(view) {
            this.view = view;
            this.bufferedChanges = this.view.state.changes()
            this.callbackId = setInterval(this.sync.bind(this), 2000)
        }
        update(update) {
            if (!this.destroyed && update.docChanged) {
                this.bufferedChanges = this.bufferedChanges.compose(update.changes)
            }
        }
        destroy() {
            this.destroyed = true
            clearInterval(this.callbackId)
        }
        async sync() {
            let buffer = new DocumentTransaction(this.version, []);
            this.bufferedChanges.iterChanges((fromA, toA, fromB, toB, inserted) => {
                if (fromA === toA) {
                    // insertion
                    buffer.stringInsert("/doc", fromA, inserted.toString())
                } else {
                    // replace
                    buffer.stringRemove("/doc", fromA, toA - fromA)
                    if (inserted.length > 0) {
                        buffer.stringInsert("/doc", fromA, inserted.toString())
                    }
                }
            })
            if (buffer.changes.length > 0) {
                try {
                    const syncResp = await fetch("/doc", {
                        method: "PATCH",
                        headers: {
                            "content-type": "application/json"
                        },
                        body: JSON.stringify({
                            key: "markdown",
                            baseTimestamp: buffer.baseTimestamp,
                            delta: buffer.changes,
                            sessionId: this.clientId,
                        })
                    })

                    if (syncResp.ok) {
                        this.bufferedChanges = this.view.state.changes();
                    } else {
                        console.log("Failed to synchronize: request error", syncResp)
                    }
                } catch (e) {
                    console.log("Failed to synchronize: fetch error", e)
                }
            }
        }
    });
    return plugin
}

try {
    const createResponse = await fetch("/doc", {
        method: "POST",
        body: JSON.stringify({ key: "markdown" }),
        headers: {
            "content-type": "application/json"
        }
    });
    if (!createResponse.ok && createResponse.status != 409) {
        throw new Error("Failed to create document");
    }
    const contentResponse = await fetch("/doc?key=markdown");
    if (!contentResponse.ok) {
        throw new Error("Failed to read document");
    }
    const body = await contentResponse.json();
    const hlc = body.hlc;
    let editor = new EditorView({
        extensions: [basicSetup, markdown(), syncExtension(hlc)],
        parent: document.body,
        doc: body.contents.doc
    })
} catch (e) {
    console.log(e)
    document.body.innerHTML = e.toString()
}