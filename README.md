# Woshmart

Woshmart is a WhatsApp based laundry pickup and delivery ordering system for Wosh Mart Services in Minna, Nigeria. Customers place and track their orders entirely through WhatsApp, with no app to download and no account to create.

## How it works

Customers order entirely through WhatsApp. They message the business number, pick a bundle, give a pickup address and a preferred pickup time, choose bank transfer or cash on delivery, confirm the order, and that's it.

Woshmen, the delivery couriers, and the partner laundries send simple text commands over WhatsApp to update an order's status as it moves through pickup, laundry, and delivery. The system automatically tells the customer what's happening at each step, so no one has to call or check in manually.

Staff manage everything through a web dashboard, including verifying payments, assigning couriers and laundries to orders, and tracking every order's progress. Different staff roles have different levels of access.

There is no payment gateway. Payment is by bank transfer, checked manually by staff, or cash on delivery.

## Tech stack

Node.js, TypeScript, Express, PostgreSQL, Redis, and Twilio, hosted on Render, with the admin dashboard built on Retool.

## Getting started

```bash
npm install
cp .env.example .env
# fill in .env with real values for your environment
npm run prisma:migrate
npm run dev
```
