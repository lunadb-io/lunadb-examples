import {EditorView, basicSetup} from "codemirror"
import {ViewPlugin} from "@codemirror/view"
import {ChangeSet} from "@codemirror/state"
import {markdown} from "@codemirror/lang-markdown"
import { DocumentTransaction } from "@lunadb-io/lunadb-client-js";

function syncExtension(initialVersion) {
    document.getElementById("lastSynced").innerText = "Last synced at: " + initialVersion

    return ViewPlugin.fromClass(class {
        clientId = crypto.randomUUID()
        destroyed = false
        syncing = false
        version = initialVersion
        applyingUpdates = false

        constructor(view) {
            this.view = view
            this.bufferedChanges = this.view.state.changes()
            this.callbackId = setInterval(this.sync.bind(this), 2000)
        }

        update(update) {
            if (!this.destroyed && !this.applyingUpdates && update.docChanged) {
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
            let failed = false

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

                    let rawChangeset = this.toChangeSet(body.changes)
                    let remoteChangeset = ChangeSet.of(rawChangeset, syncingChanges.length).map(syncingChanges, true)

                    if (!remoteChangeset.empty) {
                        let remapped = remoteChangeset.map(this.bufferedChanges, true)
                        this.applyChanges(remapped)
                        this.bufferedChanges = this.bufferedChanges.map(remoteChangeset)
                    }
                    this.version = body.hlc
                } else {
                    console.log("Failed to synchronize: request error", syncResp)
                    failed = true
                }
            } catch (e) {
                console.log("Failed to synchronize: fetch error", e)
                failed = true
            }

            if (failed) {
                document.getElementById("lastSynced").innerText = "Failed to sync!"
                this.destroy()
            } else {
                document.getElementById("lastSynced").innerText = "Last synced at: " + this.version
            }
            this.syncing = false;
        }

        applyChanges(changeset) {
            this.applyingUpdates = true;
            this.view.dispatch({changes: changeset, remote: true})
            this.applyingUpdates = false;
        }

        toTransaction(changeset) {
            let buffer = new DocumentTransaction(this.version, [])
            changeset.iterChanges((fromA, toA, fromB, toB, inserted) => {
                if (fromA === toA) {
                    buffer.stringInsert("/doc", fromA, inserted.toString())
                } else {
                    buffer.stringRemove("/doc", fromA, toA - fromA)
                    if (inserted.length > 0) {
                        buffer.stringInsert("/doc", fromA, inserted.toString())
                    }
                }
            })
            return buffer
        }

        toChangeSet(changes) {
            let changeset = []
            for (const change of changes) {
                if (change.pointer === "/doc") {
                    if (change.op === "stringinsert") {
                        changeset.push({from: change.idx, insert: change.content})
                    } else if (change.op === "stringremove") {
                        changeset.push({from: change.idx, to: change.idx + change.len})
                    }
                }
            }
            return changeset
        }
    })
}

try {
    const createOrGetResponse = await fetch("/doc", {
        method: "POST",
        body: JSON.stringify({ key: "markdown" }),
        headers: {
            "content-type": "application/json"
        }
    });
    if (!createOrGetResponse.ok) {
        throw new Error("Failed to create document");
    }
    const body = await createOrGetResponse.json();
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