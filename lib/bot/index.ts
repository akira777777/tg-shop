import { Bot } from 'grammy';
import { registerCommands } from './commands';
import { registerRelayHandlers } from './relay';

// Singleton bot instance — reused across warm serverless invocations
export const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN!);

registerCommands(bot);
registerRelayHandlers(bot);
