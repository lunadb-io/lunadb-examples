import { EditorView, basicSetup } from "codemirror";
import { ViewPlugin } from "@codemirror/view";
import { ChangeSet } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { DocumentTransaction } from "@lunadb-io/lunadb-client-js";

let syncPaused = false;

function syncExtension(initialVersion) {
  document.getElementById("lastSynced").innerText =
    "Last synced at: " + initialVersion;

  return ViewPlugin.fromClass(
    class {
      clientId = crypto.randomUUID();
      version = initialVersion;
      destroyed = false;
      syncing = false;
      applyingUpdates = false;

      constructor(view) {
        this.view = view;
        this.bufferedChanges = this.view.state.changes();
        this.callbackId = setInterval(this.sync.bind(this), 2000);
      }

      update(update) {
        if (!this.destroyed && !this.applyingUpdates && update.docChanged) {
          this.bufferedChanges = this.bufferedChanges.compose(update.changes);
        }
      }

      destroy() {
        this.destroyed = true;
        clearInterval(this.callbackId);
      }

      async sync() {
        if (this.syncing || this.destroyed || syncPaused) {
          return;
        }

        this.syncing = true;
        let syncingChanges = this.bufferedChanges;
        this.bufferedChanges = this.view.state.changes();
        let buffer = this.toTransaction(syncingChanges);

        try {
          const body = await this.fetchUpdates(buffer);

          if (!body) {
            console.log("Request error", syncResp);
            this.bufferedChanges = syncingChanges.compose(this.bufferedChanges);
            return;
          }

          let remoteChangeset = ChangeSet.of(
            this.toChangeSet(body.changes),
            syncingChanges.length
          ).map(syncingChanges, true);

          if (!remoteChangeset.empty) {
            let remapped = remoteChangeset.map(this.bufferedChanges, true);
            this.applyChanges(remapped);
            this.bufferedChanges = this.bufferedChanges.map(remoteChangeset);
          }

          this.version = body.hlc;
        } catch (e) {
          console.log("Failed to synchronize", e);
          document.getElementById("lastSynced").innerText = "Failed to sync!";
          this.destroy();
          return;
        }

        document.getElementById("lastSynced").innerText =
          "Last synced at: " + this.version;
        this.syncing = false;
      }

      async fetchUpdates(txn) {
        const syncResp = await fetch("/doc", {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            key: "markdown",
            baseTimestamp: txn.baseTimestamp,
            delta: txn.changes,
            sessionId: this.clientId,
          }),
        });

        if (syncResp.ok) {
          return await syncResp.json();
        } else {
          console.log("Request error", syncResp);
          return null;
        }
      }

      applyChanges(changeset) {
        this.applyingUpdates = true;
        this.view.dispatch({ changes: changeset, remote: true });
        this.applyingUpdates = false;
      }

      toTransaction(changeset) {
        let buffer = new DocumentTransaction(this.version, []);
        changeset.iterChanges((fromA, toA, fromB, toB, inserted) => {
          if (fromA === toA) {
            buffer.stringInsert("/doc", fromA, inserted.toString());
          } else {
            buffer.stringRemove("/doc", fromA, toA - fromA);
            if (inserted.length > 0) {
              buffer.stringInsert("/doc", fromA, inserted.toString());
            }
          }
        });
        return buffer;
      }

      toChangeSet(changes) {
        let changeset = [];
        for (const change of changes) {
          if (change.pointer === "/doc") {
            if (change.op === "stringinsert") {
              changeset.push({ from: change.idx, insert: change.content });
            } else if (change.op === "stringremove") {
              changeset.push({ from: change.idx, to: change.idx + change.len });
            }
          }
        }
        return changeset;
      }
    }
  );
}

try {
  const createOrGetResponse = await fetch("/doc", {
    method: "POST",
    body: JSON.stringify({ key: "markdown" }),
    headers: {
      "content-type": "application/json",
    },
  });
  if (!createOrGetResponse.ok) {
    throw new Error("Failed to create document");
  }
  const body = await createOrGetResponse.json();
  const hlc = body.hlc;
  const ext = syncExtension(hlc);

  document.getElementById("pauseButton").onclick = function () {
    if (syncPaused) {
      syncPaused = false;
      document.getElementById("pauseButton").innerText = "Pause Sync";
    } else {
      syncPaused = true;
      document.getElementById("pauseButton").innerText = "Resume Sync";
    }
  };

  let editor = new EditorView({
    extensions: [basicSetup, markdown(), ext],
    parent: document.body,
    doc: body.contents.doc,
  });
} catch (e) {
  console.log(e);
  document.body.innerHTML = e.toString();
}
