const express = require("express");
const body_parser = require("body-parser");
const axios = require("axios");
require('dotenv').config();
const OracleBot = require('@oracle/bots-node-sdk');
const {
    WebhookClient,
    WebhookEvent
} = OracleBot.Middleware;

const app = express().use(body_parser.json());
OracleBot.init(app);
const token = process.env.TOKEN;
const mytoken = process.env.MYTOKEN; //Ansh_token
let phon_no_id;
let from;

// add webhook integration to Oracle Cloud
const webhook = new WebhookClient({
    channel: {
        url: 'https://idcs-oda-3c0156114a044dd09a61dfa73a88efa2-da3.data.digitalassistant.oci.oraclecloud.com/connectors/v2/listeners/webhook/channels/9a727757-51c0-475a-ad9b-eee0bc47eb80',
        secret: 'huDvtUX2t4SUz58wWyAKwHZcbtxbuswV'
    }
});

webhook
    .on(WebhookEvent.ERROR, err => console.log('Ansh webhook Error:', err.message))
    .on(WebhookEvent.MESSAGE_SENT, message => console.log('Ansh Message to chatbot:', message));
app.post('/bot/message', webhook.receiver()); // receive bot messages


app.listen(process.env.PORT, () => {
    console.log("Hi Ansh. your Webhook is listening");
});

//to verify the callback url from cloud api side
app.get("/webhook", (req, res) => {
    let mode = req.query["hub.mode"];
    let challange = req.query["hub.challenge"];
    let token = req.query["hub.verify_token"];
    if (mode && token) {
        if (mode === "subscribe" && token === mytoken) {
            res.status(200).send(challange);
        } else {
            res.status(403);
        }
    }
});

webhook.on(WebhookEvent.MESSAGE_RECEIVED, recievedMessage => {
    console.log('Received a message from ODA, processing message before sending to WhatsApp. *****************>');
    console.log(recievedMessage.messagePayload.text);

    axios({
        method: "POST",
        url: "https://graph.facebook.com/v13.0/" + phon_no_id + "/messages?access_token=" + token,
        data: {
            messaging_product: "whatsapp",
            to: from,
            text: {
                body: recievedMessage.messagePayload.text
            }
        },
        headers: {
            "Content-Type": "application/json"
        }
    });
});

app.post("/webhook", (req, res) => { //i want some 
    let body_param = req.body;
    console.log(JSON.stringify(body_param, null, 2));
    if (body_param.object) {
        console.log("Ansh i am inside body");
        if (body_param.entry &&
            body_param.entry[0].changes &&
            body_param.entry[0].changes[0].value.messages &&
            body_param.entry[0].changes[0].value.messages[0]
        ) {
            phon_no_id = body_param.entry[0].changes[0].value.metadata.phone_number_id;
            from = body_param.entry[0].changes[0].value.messages[0].from;
            let msg_body = body_param.entry[0].changes[0].value.messages[0].text.body;
            let userName = body_param.entry[0].changes[0].value.contacts[0].profile.name;
            console.log("Ansh i am inside details -------------------------------------->");
            console.log("phone number " + phon_no_id);
            console.log("from " + from);
            console.log("Message from sender is --> " + msg_body);
            console.log("User name of the sender-->" + userName);
            // Ansh Sending Message from Whats app to ODA
            const MessageModel = webhook.MessageModel();
            const message = {
                userId: 'anonymous',
                profile: {firstName: userName, lastName:from},
                messagePayload: MessageModel.textConversationMessage(msg_body)
            };
            console.log("Ansh your Message before sending to ODA is ------>" + message);
            webhook.send(message)
            res.sendStatus(200);
        } else {
            res.sendStatus(404);
        }
    }
});

app.get("/", (req, res) => {
    res.status(200).send("Hello Ansh this is webhook setup");
});