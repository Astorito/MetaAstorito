const mongoose = require('mongoose');

const listSchema = new mongoose.Schema({
  phone: {
    type: String,
    required: true
  },
  name: {
    type: String,
    required: true
  },
  items: [{
    text: String,
    checked: {
      type: Boolean,
      default: false
    }
  }],
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('List', listSchema);
