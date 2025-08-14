const emojiMap = {
  // Salud
  "doctor": "👨‍⚕️",
  "medico": "👨‍⚕️",
  "hospital": "🏥",
  // ...resto del mapa de emojis...
  "default": "📅"
};

function findBestEmoji(title) {
  const words = title.toLowerCase().split(/\s+/);
  
  for (const word of words) {
    if (emojiMap[word]) return emojiMap[word];
  }
  
  for (const [key, emoji] of Object.entries(emojiMap)) {
    if (words.some(word => word.includes(key) || key.includes(word))) {
      return emoji;
    }
  }
  
  return emojiMap.default;
}

module.exports = { findBestEmoji };