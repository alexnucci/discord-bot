# Discord Bot Service

A resilient Discord bot that turns your server's events into workflow triggers. Built with Deno and PGMQ, it captures Discord events, reliably queues them for processing, and stores them in PostgreSQL—enabling you to build powerful automation workflows with tools like n8n, trigger.dev, Make, or Zapier.

## Why This Bot?

- **Event Reliability**: Never miss a Discord event—all messages and interactions are captured and queued
- **Scale Ready**: Producer-consumer architecture handles high-volume Discord servers with ease
- **Workflow Freedom**: Store events in PostgreSQL to trigger downstream automations your way
- **Built to Last**: Production-ready with automatic restarts, error tracking, and containerization

## Configuration

- **Runtime**: Deno
- **Databases**:
  - PostgreSQL for application data
  - PostgreSQL with PGMQ extension for message queuing (required)
- **Network**: Uses external common-network for service communication

## Features

- Producer-consumer architecture
- Message queue-based processing using PGMQ
- Error tracking with Sentry
- Automatic container restarts
- Separate consumer process
- Production-ready configuration

## Infrastructure

### Components
- **Bot Service**: Main Discord bot process (producer)
- **Consumer Service**: Dedicated message processing worker
- **Queue Management**: PostgreSQL with PGMQ extension
- **Data Storage**: PostgreSQL
- **Error Tracking**: Sentry integration (optional)

### Services
#### Bot Service (Producer)
- Handles Discord events
- Enqueues messages for processing
- Manages bot interactions
- Maintains Discord connection

#### Consumer Service
- Processes queued messages
- Executes bot commands
- Handles long-running tasks
- Manages database operations

## Database Configuration

### Application Database
- Any PostgreSQL instance
- Dedicated service user recommended
- Stores bot state and data

### Queue Database
- PostgreSQL instance with PGMQ extension installed
- Used for message queue management
- Handles task distribution
- Can be same or separate from application database

## Environment Configuration

Key configurations managed through environment variables (see `.env.example`):
- Database connections (Application and Queue)
- Discord bot credentials
- Sentry DSN (optional)
- Environment designation

## Setup Requirements

1. **Discord Bot Setup**:
   - Create a Discord application at [Discord Developer Portal](https://discord.com/developers/applications)
   - Create a bot and get the bot token
   - Enable necessary bot permissions
   - Get the public key

2. **Database Setup**:
   - PostgreSQL instance for application data
   - PostgreSQL instance with PGMQ extension for queuing
     - [PGMQ Installation Guide](https://github.com/tembo-io/pgmq)
   - Create dedicated database users

3. **Environment Configuration**:
   - Copy `.env.example` to `.env`
   - Fill in required credentials

## Usage

### Starting the Service
```bash
docker-compose up -d
```

### Stopping the Service
```bash
docker-compose down
```

### Viewing Logs
```bash
# Bot logs
docker-compose logs -f discord-bot

# Consumer logs
docker-compose logs -f consumer
```

## Security Notes

- Keep `.env` file secure and never commit to repository
- Use dedicated database users with minimal required permissions
- Network isolation through Docker
- Environment-based configuration
- Error tracking in production (optional)

## Development

The service is built using:
- Deno runtime
- TypeScript
- Discord.js library
- PGMQ for queuing
- Docker for containerization