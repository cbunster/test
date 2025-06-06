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
const mytoken = process.env.MYTOKEN; // Ansh_token
let phon_no_id;
let from;

// Manejador global de promesas rechazadas
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    // Opcional: No terminar el proceso para mantener el webhook activo
    // process.exit(1);
});

// Manejador global de excepciones no capturadas
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    // Reiniciar el proceso después de un error crítico
    process.exit(1);
});

// Configuración del webhook de Oracle
const webhook = new WebhookClient({
    channel: {
        url: 'https://idcs-oda-7d52b071bf824e7daca8dbba74a7dce7-da3.data.digitalassistant.oci.oraclecloud.com/connectors/v2/listeners/webhook/channels/8ec02b12-bb24-4a89-b973-93985b963b37',
        secret: 'qwIuHj1N9xs8L454uehE8iTBtRIxS870'
    }
});

// Manejo de eventos del webhook con manejo de errores
webhook
    .on(WebhookEvent.ERROR, err => {
        console.error('Webhook Error:', err.message);
        console.error('Error details:', err);
    })
    .on(WebhookEvent.MESSAGE_SENT, message => {
        console.log('Message sent to chatbot:', message);
    });

// Endpoint para recibir mensajes del bot
app.post('/bot/message', webhook.receiver());

// Función para enviar mensaje a WhatsApp con manejo de errores
async function sendToWhatsApp(phoneNumberId, recipientNumber, messageText) {
    try {
        console.log('Enviando mensaje a WhatsApp:', {
            phoneNumberId,
            recipientNumber,
            messageText
        });

        const response = await axios({
            method: "POST",
            url: `https://graph.facebook.com/v13.0/${phoneNumberId}/messages?access_token=${token}`,
            data: {
                messaging_product: "whatsapp",
                to: recipientNumber,
                text: {
                    body: messageText
                }
            },
            headers: {
                "Content-Type": "application/json"
            },
            timeout: 10000 // 10 segundos de timeout
        });

        console.log('Mensaje enviado exitosamente a WhatsApp:', response.status);
        return response.data;

    } catch (error) {
        console.error('Error enviando mensaje a WhatsApp:', error.message);
        if (error.response) {
            console.error('Error response:', error.response.data);
            console.error('Error status:', error.response.status);
        }
        throw error; // Re-lanzar para manejo superior
    }
}

// Función para enviar mensaje a Oracle con manejo de errores
async function sendToOracle(messageData) {
    try {
        console.log('Enviando mensaje a Oracle:', messageData);
        
        const result = await new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                reject(new Error('Timeout enviando mensaje a Oracle'));
            }, 15000); // 15 segundos de timeout

            webhook.send(messageData)
                .then(result => {
                    clearTimeout(timeoutId);
                    resolve(result);
                })
                .catch(error => {
                    clearTimeout(timeoutId);
                    reject(error);
                });
        });

        console.log('Mensaje enviado exitosamente a Oracle');
        return result;

    } catch (error) {
        console.error('Error enviando mensaje a Oracle:', error.message);
        throw error;
    }
}

// Manejo de mensajes recibidos de Oracle
webhook.on(WebhookEvent.MESSAGE_RECEIVED, async (receivedMessage) => {
    try {
        console.log('Mensaje recibido de Oracle, procesando antes de enviar a WhatsApp...');
        console.log('Contenido del mensaje:', receivedMessage.messagePayload.text);

        if (!phon_no_id || !from) {
            console.error('Error: phone_number_id o from no están definidos');
            return;
        }

        await sendToWhatsApp(phon_no_id, from, receivedMessage.messagePayload.text);
        
    } catch (error) {
        console.error('Error procesando mensaje recibido de Oracle:', error.message);
    }
});

// Verificación del callback URL de WhatsApp
app.get("/webhook", (req, res) => {
    try {
        let mode = req.query["hub.mode"];
        let challenge = req.query["hub.challenge"];
        let token = req.query["hub.verify_token"];
        
        console.log('Verificación del webhook:', { mode, challenge, token });
        
        if (mode && token) {
            if (mode === "subscribe" && token === mytoken) {
                console.log('Webhook verificado exitosamente');
                res.status(200).send(challenge);
            } else {
                console.log('Token de verificación inválido');
                res.status(403).send('Token inválido');
            }
        } else {
            console.log('Parámetros de verificación faltantes');
            res.status(400).send('Parámetros faltantes');
        }
    } catch (error) {
        console.error('Error en verificación del webhook:', error.message);
        res.status(500).send('Error interno del servidor');
    }
});

// Endpoint principal para recibir mensajes de WhatsApp
app.post("/webhook", async (req, res) => {
    try {
        let body_param = req.body;
        console.log('Mensaje recibido de WhatsApp:', JSON.stringify(body_param, null, 2));
        
        if (!body_param.object) {
            console.log('Objeto no válido en el cuerpo de la petición');
            return res.status(400).send('Objeto no válido');
        }

        console.log("Procesando mensaje de WhatsApp...");
        
        // Validar estructura del mensaje
        if (!body_param.entry || 
            !body_param.entry[0] || 
            !body_param.entry[0].changes || 
            !body_param.entry[0].changes[0] || 
            !body_param.entry[0].changes[0].value) {
            console.log('Estructura de mensaje inválida');
            return res.status(200).send('OK'); // Responder OK para evitar reintentos
        }

        const change = body_param.entry[0].changes[0];
        const value = change.value;

        // Verificar si hay mensajes
        if (!value.messages || !value.messages[0]) {
            console.log('No hay mensajes en la petición');
            return res.status(200).send('OK');
        }

        const message = value.messages[0];
        
        // Extraer información del mensaje
        phon_no_id = value.metadata?.phone_number_id;
        from = message.from;
        let msg_body = message.text?.body;
        let userName = value.contacts?.[0]?.profile?.name || 'Usuario';

        // Validar datos esenciales
        if (!phon_no_id || !from || !msg_body) {
            console.error('Datos esenciales faltantes:', { phon_no_id, from, msg_body });
            return res.status(200).send('OK');
        }

        console.log('Detalles del mensaje:');
        console.log('Phone number ID:', phon_no_id);
        console.log('From:', from);
        console.log('Message body:', msg_body);
        console.log('User name:', userName);

        // Crear mensaje para Oracle
        const MessageModel = webhook.MessageModel();
        const oracleMessage = {
            userId: from, // Usar el número de teléfono como userId
            profile: { 
                firstName: userName, 
                lastName: from 
            },
            messagePayload: MessageModel.textConversationMessage(msg_body)
        };

        console.log('Enviando mensaje a Oracle...');
        
        // Enviar mensaje a Oracle
        await sendToOracle(oracleMessage);
        
        res.status(200).send('OK');
        
    } catch (error) {
        console.error('Error procesando webhook de WhatsApp:', error.message);
        console.error('Stack trace:', error.stack);
        
        // Siempre responder con 200 para evitar reintentos de WhatsApp
        res.status(200).send('OK');
    }
});

// Endpoint de prueba
app.get("/", (req, res) => {
    res.status(200).send("Hello! WhatsApp-Oracle webhook is running successfully");
});

// Middleware de manejo de errores global
app.use((error, req, res, next) => {
    console.error('Error global:', error.message);
    res.status(500).json({
        error: 'Internal server error',
        message: error.message
    });
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Webhook listening on port ${PORT}`);
    console.log('WhatsApp-Oracle integration is ready!');
});

// Manejo graceful del cierre del servidor
process.on('SIGTERM', () => {
    console.log('Received SIGTERM, shutting down gracefully');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('Received SIGINT, shutting down gracefully');
    process.exit(0);
});
