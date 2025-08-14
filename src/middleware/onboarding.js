const User = require('../models/user');
const { capitalizeFirst } = require('../utils/formatter');

async function handleOnboarding(from, messageText) {
  let user = await User.findOne({ phone: from });
  if (!user) {
    user = new User({ phone: from });
    await user.save();
  }

  if (user.onboardingState.completed) {
    return null;
  }

  let response;
  let shouldContinue = true;

  switch (user.onboardingState.currentStep) {
    case 'welcome':
      response = "Hola! Soy Astorito, como es tu nombre?";
      user.onboardingState.currentStep = 'ask_name';
      break;

    case 'ask_name':
      user.name = capitalizeFirst(messageText.trim());
      user.onboardingState.currentStep = 'ask_email';
      response = "Podrás pasarme tu email?";
      break;

    case 'ask_email':
      if (messageText.includes('@')) {
        user.email = messageText.trim().toLowerCase();
        user.onboardingState.currentStep = 'completed';
        user.onboardingState.completed = true;
        response = `🌟 Déjame contarte en qué puedo ayudarte:\n\n` +
          "1. Puedo crear recordatorios para tus eventos y tareas importantes\n" +
          "2. Puedo procesar mensajes de voz si prefieres hablar