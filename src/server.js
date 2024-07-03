import 'dotenv/config'
import express from 'express'
import { v0betaCreateDocument, v0betaDeleteDocument, v0betaGetDocumentContent, v0betaSyncDocument } from '@lunadb-io/lunadb-client-js'

const app = express()
const port = 3000

app.use(express.static('static'))
app.use(express.json())

let opts = {};
if (process.env.LUNADB_PASSWD) {
    opts.basicAuth = process.env.LUNADB_PASSWD
}

app.post('/doc', async (req, res) => {
    const { key } = req.body
    try {
        await v0betaCreateDocument(process.env.LUNADB_HOST, key, opts)
        res.status(201)

        try {
            await v0betaSyncDocument(
                process.env.LUNADB_HOST,
                key,
                "0",
                [{
                    op: "insert",
                    pointer: "/doc",
                    content: ""
                }]
            )
        } catch (e) {
            console.log("Failed to create initial document contents. Document should be recreated!", e)
            res.status(500).end()
            return
        }

        console.log("Document created: " + key)
    } catch (e) {
        if (e.status === 409) {
            res.status(200)
        } else {
            console.log("Failed to create document", e)
            res.status(500).end()
            return
        }
    }

    try {
        const resp = await v0betaGetDocumentContent(process.env.LUNADB_HOST, key, opts)
        res.json(resp.content)
    } catch (e) {
        res.status(500).end()
    }
})

app.delete('/doc', async (req, res) => {
    const { key } = req.body
    try {
        const resp = await v0betaDeleteDocument(process.env.LUNADB_HOST, key, opts)
        console.log("Document deleted: " + key)
        res.status(resp.status).end()
    } catch (e) {
        console.log(e);
        if (e.status < 0) {
            res.status(500).end()
        } else {
            res.status(e.status).end()
        }
    }
})

app.patch('/doc', async (req, res) => {
    const { key } = req.body
    let baseTimestamp = undefined;
    let delta = undefined;
    let sessionId = undefined;
    let sessionMetadata = undefined;
    let fetchAllPresenceData = undefined;
    if ("baseTimestamp" in req.body) {
        baseTimestamp = req.body.baseTimestamp;
    }
    if ("delta" in req.body) {
        delta = req.body.delta;
    }
    if ("sessionId" in req.body) {
        sessionId = req.body.sessionId;
    }
    if ("sessionMetadata" in req.body) {
        sessionMetadata = req.body.sessionMetadata;
    }
    if ("fetchAllPresenceData" in req.body) {
        fetchAllPresenceData = req.body.fetchAllPresenceData;
    }
    try {
        const resp = await v0betaSyncDocument(
            process.env.LUNADB_HOST, 
            key, 
            baseTimestamp, 
            delta, 
            sessionId,
            "joined",
            sessionMetadata, 
            fetchAllPresenceData, 
            false, 
            opts
        )
        res.status(resp.status).json(resp.content)
    } catch (e) {
        console.log(e);
        if (e.status < 0) {
            res.status(500).end()
        } else {
            res.status(e.status).end()
        }
    }
})

app.listen(port, () => {
  console.log(`Listening on port ${port}`)
})