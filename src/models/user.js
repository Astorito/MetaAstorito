const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  phone: { type: String, unique: true },
  name: String,
  email: String,
  onboardingState: {
    currentStep: { 
      type: String, 
      enum: ['welcome', 'ask_name', 'ask_email', 'completed'],
      default: 'welcome'
    },
    completed: { type: Boolean, default: false }
  },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', userSchema);