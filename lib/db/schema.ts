import {
  pgTable,
  serial,
  text,
  integer,
  bigint,
  boolean,
  numeric,
  timestamp,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  telegramId: bigint('telegram_id', { mode: 'number' }).primaryKey(),
  username: text('username'),
  firstName: text('first_name').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const products = pgTable('products', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  priceUsdt: numeric('price_usdt', { precision: 18, scale: 6 }).notNull(),
  category: text('category').notNull().default('General'),
  imageUrl: text('image_url'),
  stock: integer('stock').notNull().default(0),
  active: boolean('active').notNull().default(true),
});

export const orders = pgTable('orders', {
  id: serial('id').primaryKey(),
  userId: bigint('user_id', { mode: 'number' }).references(() => users.telegramId),
  // pending | awaiting_payment | paid | processing | shipped | delivered | cancelled
  status: text('status').notNull().default('pending'),
  totalUsdt: numeric('total_usdt', { precision: 18, scale: 6 }).notNull(),
  paymentAddress: text('payment_address').notNull(),
  paymentAmountTon: numeric('payment_amount_ton', { precision: 18, scale: 9 }),
  txHash: text('tx_hash'),
  createdAt: timestamp('created_at').defaultNow(),
  paidAt: timestamp('paid_at'),
});

export const orderItems = pgTable('order_items', {
  id: serial('id').primaryKey(),
  orderId: integer('order_id').references(() => orders.id),
  productId: integer('product_id').references(() => products.id),
  quantity: integer('quantity').notNull(),
  priceUsdt: numeric('price_usdt', { precision: 18, scale: 6 }).notNull(),
});

export const messages = pgTable('messages', {
  id: serial('id').primaryKey(),
  userId: bigint('user_id', { mode: 'number' }).references(() => users.telegramId),
  // 'user_to_admin' | 'admin_to_user'
  direction: text('direction').notNull(),
  content: text('content').notNull(),
  telegramMsgId: integer('telegram_msg_id'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const suggestions = pgTable('suggestions', {
  id: serial('id').primaryKey(),
  userId: bigint('user_id', { mode: 'number' }).references(() => users.telegramId),
  productName: text('product_name').notNull(),
  description: text('description'),
  createdAt: timestamp('created_at').defaultNow(),
});
