const { DateTime } = require('luxon');

function parseRelativeDate(input) {
  if (typeof input !== 'string') return null;
  
  input = input.toLowerCase().trim();
  const now = DateTime.now();
  
  if (input === "hoy") return now.toFormat('yyyy-MM-dd');
  if (input === "mañana") return now.plus({ days: 1 }).toFormat('yyyy-MM-dd');

  const match = input.match(/en (\d+) (día|dias|días|semana|semanas)/);
  if (match) {
    const num = parseInt(match[1]);
    const unit = match[2].startsWith('semana') ? { weeks: num } : { days: num };
    return now.plus(unit).toFormat('yyyy-MM-dd');
  }

  return null;
}

function formatDateTime(date) {
  return DateTime.fromJSDate(date)
    .setZone('America/Argentina/Buenos_Aires')
    .toFormat("dd/MM/yyyy 'a las' HH:mm");
}

module.exports = { parseRelativeDate, formatDateTime };