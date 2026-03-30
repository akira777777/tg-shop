import 'dotenv/config';
import { bot } from './lib/bot/index';

bot.catch((err) => {
  console.error('Bot error:', err.message);
});

console.log('Starting bot in long-polling mode...');
bot.start({
  onStart: (info) => console.log(`Bot @${info.username} is running`),
});
