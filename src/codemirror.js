import {EditorView, basicSetup} from "codemirror"
import {ViewPlugin} from "@codemirror/view"
import {ChangeSet} from "@codemirror/state"
import {markdown} from "@codemirror/lang-markdown"
import { DocumentTransaction } from "@lunadb-io/lunadb-client-js";

function syncExtension(initialVersion) {
    document.getElementById("lastSynced").innerText = "Last synced at: " + initialVersion

    let plugin = ViewPlugin.fromClass(class {
        clientId = crypto.randomUUID()
        destroyed = false
        syncing = false
        version = initialVersion
        disableUpdate = false

        constructor(view) {
            this.view = view
            this.bufferedChanges = this.view.state.changes()
            this.callbackId = setInterval(this.sync.bind(this), 2000)
        }

        update(update) {
            if (!this.destroyed && !this.disableUpdate && update.docChanged) {
                this.bufferedChanges = this.bufferedChanges.compose(update.changes)
            }
        }

        destroy() {
            this.destroyed = true
            clearInterval(this.callbackId)
        }

        async sync() {
            if (this.syncing || this.destroyed) {
                return;
            }

            this.syncing = true;
            let syncingChanges = this.bufferedChanges
            this.bufferedChanges = this.view.state.changes()
            let buffer = this.toTransaction(syncingChanges)

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
                    const body = await syncResp.json()
                    let remoteChangeset = this.toChangeSet(body.changes, this.bufferedChanges.newLength)
                    if (!remoteChangeset.empty) {
                        // todo: lunadb needs to not return our local changes in its response
                        this.disableUpdate = true
                        this.view.dispatch({changes: remoteChangeset, remote: true})
                        this.disableUpdate = false
                        this.bufferedChanges = this.bufferedChanges.map(remoteChangeset)
                    }
                    this.version = body.hlc
                } else {
                    console.log("Failed to synchronize: request error", syncResp)
                    this.bufferedChanges = syncingChanges.compose(this.bufferedChanges)
                }
            } catch (e) {
                console.log("Failed to synchronize: fetch error", e)
                this.bufferedChanges = syncingChanges.compose(this.bufferedChanges)
            }

            document.getElementById("lastSynced").innerText = "Last synced at: " + this.version
            this.syncing = false;
        }

        toTransaction(changeset) {
            let buffer = new DocumentTransaction(this.version, [])
            changeset.iterChanges((fromA, toA, fromB, toB, inserted) => {
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
            return buffer
        }

        toChangeSet(changes, baseLength) {
            let changeset = []
            for (const change of changes) {
                if (change.pointer === "/doc") {
                    if (change.op === "stringinsert") {
                        changeset.push({from: change.idx, insert: change.content})
                    } else if (change.op === "stringremove") {
                        changeset.push({from: change.idx, to: change.len})
                    }
                }
            }
            return ChangeSet.of(changeset, baseLength)
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