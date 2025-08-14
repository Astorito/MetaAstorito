const { verifyToken } = require('../config/environment');

function verifyWebhook(req, res, next) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === verifyToken) {
      console.log('Webhook verificado!');
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  }
  next();
}

module.exports = { verifyWebhook };