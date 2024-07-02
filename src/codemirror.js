import {EditorView, basicSetup} from "codemirror"
import {markdown} from "@codemirror/lang-markdown"

let editor = new EditorView({
  extensions: [basicSetup, markdown()],
  parent: document.body
})