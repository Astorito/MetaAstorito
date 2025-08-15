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
  let shouldContinue = false; // Solo avanza si el usuario responde correctamente

  switch (user.onboardingState.currentStep) {
    case 'welcome':
      response = "¡Hola! Soy Astorito 😊 ¿Cómo es tu nombre?";
      user.onboardingState.currentStep = 'ask_name';
      break;

    case 'ask_name':
      if (messageText && messageText.trim().length > 1) {
        user.name = capitalizeFirst(messageText.trim());
        response = "Gracias! ¿Podés pasarme tu email?";
        user.onboardingState.currentStep = 'ask_email';
      } else {
        response = "Por favor, decime tu nombre para continuar.";
      }
      break;

    case 'ask_email':
      if (messageText && messageText.includes('@')) {
        user.email = messageText.trim().toLowerCase();
        user.onboardingState.currentStep = 'completed';
        user.onboardingState.completed = true;
        response = `🌟 ¡Listo ${user.name}! Ahora podés usar todas las funciones de Astorito.\n\n` +
          "1. Puedo crear recordatorios para tus eventos y tareas importantes\n" +
          "2. Puedo procesar mensajes de voz si preferís hablar en lugar de escribir\n\n" +
          "3. Podes consultarme el clima de tu ciudad\n\n"
          "Si necesitás un Astorito más poderoso, visitá https://astorito.ai y encontra a los Astoritos para empresas\n\n" +
          "¡Un abrazo de carpincho 🦫!";
      } else {
        response = "Por favor, ingresá un correo electrónico válido.";
      }
      break;
  }

  await user.save();
  return { message: response, shouldContinue };
}

module.exports = { handleOnboarding };