import 'dotenv/config';

import {
  Client,
  Collection,
  GatewayIntentBits,
  Routes,
} from 'discord.js';

import { REST } from '@discordjs/rest';
import express from 'express';
import cron from 'node-cron';

import config from './config/application.js';

import { initializeDatabase } from './utils/database.js';

import {
  getServerCounters,
  saveServerCounters,
  updateCounter,
} from './services/serverstatsService.js';

import {
  logger,
  startupLog,
  shutdownLog,
} from './utils/logger.js';

import { checkBirthdays } from './services/birthdayService.js';
import { checkGiveaways } from './services/giveawayService.js';

import { loadCommands } from './handlers/commandLoader.js';

import pkg from '../package.json' with { type: 'json' };

import {
  EXPECTED_SCHEMA_VERSION,
  EXPECTED_SCHEMA_LABEL,
} from './config/schemaVersion.js';


/* =========================================================
   BOT
========================================================= */

class TitanBot extends Client {

  constructor() {

    super({

      intents: [

        GatewayIntentBits.Guilds,

        GatewayIntentBits.GuildMembers,

        GatewayIntentBits.GuildMessages,

        GatewayIntentBits.GuildMessageReactions,

        /*
         * QUAN TRỌNG
         *
         * Bắt buộc để bot đọc:
         *
         * !faq
         * !clearuser
         * !lyric
         */
        GatewayIntentBits.MessageContent,

        GatewayIntentBits.DirectMessages,

        GatewayIntentBits.GuildVoiceStates,

        GatewayIntentBits.GuildBans,

      ],

    });


    /* =====================================================
       CONFIG
    ===================================================== */

    this.config = config;


    /* =====================================================
       COLLECTIONS
    ===================================================== */

    /*
     * client.commands vẫn được sử dụng cho Prefix Commands.
     *
     * Ví dụ:
     *
     * !faq
     * !clearuser
     * !lyric
     */

    this.commands =
      new Collection();


    this.events =
      new Collection();


    this.buttons =
      new Collection();


    this.selectMenus =
      new Collection();


    this.modals =
      new Collection();


    this.cooldowns =
      new Collection();


    /* =====================================================
       DATABASE
    ===================================================== */

    this.db = null;


    /* =====================================================
       REST
       -----------------------------------------------------
       CHỈ dùng để xóa Slash Commands cũ.
       KHÔNG dùng để đăng ký Slash Commands.
    ===================================================== */

    this.rest =
      new REST({
        version: '10',
      }).setToken(
        config.bot.token
      );

  }


  /* =========================================================
     START BOT
  ========================================================= */

  async start() {

    try {

      startupLog(
        'Starting TitanBot...'
      );


      await new Promise(
        resolve =>
          setTimeout(
            resolve,
            1000
          )
      );


      /* =====================================================
         DATABASE
      ===================================================== */

      startupLog(
        'Initializing database...'
      );


      const dbInstance =
        await initializeDatabase();


      this.db =
        dbInstance.db;


      const dbStatus =
        this.db.getStatus();


      if (dbStatus.isDegraded) {

        logger.warn('');

        logger.warn(
          '╔═══════════════════════════════════════════════════════╗'
        );

        logger.warn(
          '║ ⚠️  DATABASE RUNNING IN DEGRADED MODE               ║'
        );

        logger.warn(
          '║                                                       ║'
        );

        logger.warn(
          '║ Connection: In-Memory Storage                        ║'
        );

        logger.warn(
          '║ Data Persistence: DISABLED                           ║'
        );

        logger.warn(
          '║ Action Required: Fix PostgreSQL if persistence needed║'
        );

        logger.warn(
          '╚═══════════════════════════════════════════════════════╝'
        );

        logger.warn('');

      } else {

        startupLog(
          `✅ Database Status: ${dbStatus.connectionType} (fully operational)`
        );

      }


      /* =====================================================
         WEB SERVER
      ===================================================== */

      startupLog(
        'Starting web server...'
      );


      this.startWebServer();


      /* =====================================================
         LOAD COMMANDS
         -----------------------------------------------------
         CỰC KỲ QUAN TRỌNG
         
         Prefix commands vẫn cần client.commands.
         
         Ví dụ:
         
         !faq
         !clearuser
         !lyric
      ===================================================== */

      startupLog(
        'Loading commands...'
      );


      await loadCommands(
        this
      );


      startupLog(
        `Commands loaded: ${this.commands.size}`
      );


      /* =====================================================
         LOAD HANDLERS
         -----------------------------------------------------
         Load:
         
         handlers/events.js
         handlers/interactions.js
      ===================================================== */

      startupLog(
        'Loading handlers...'
      );


      await this.loadHandlers();


      startupLog(
        'Handlers loaded.'
      );


      /* =====================================================
         LOGIN DISCORD
      ===================================================== */

      startupLog(
        'Logging into Discord...'
      );


      await this.login(
        this.config.bot.token
      );


      startupLog(
        'Discord login successful.'
      );


      /* =====================================================
         DISABLE OLD SLASH COMMANDS
         -----------------------------------------------------
         Bot KHÔNG đăng ký Slash Commands mới.
         
         Chỉ xóa những Slash Commands cũ còn tồn tại
         trên Discord.
      ===================================================== */

      await this.disableSlashCommands();


      /* =====================================================
         ONLINE
      ===================================================== */

      const databaseMode =
        dbStatus.isDegraded
          ? 'Optional in-memory mode'
          : 'Connected (persistent data enabled)';


      const handlerSummary =
        `${this.buttons.size} buttons, ` +
        `${this.selectMenus.size} menus, ` +
        `${this.modals.size} modals`;


      startupLog(
        `ONLINE ✅ | ` +
        `${this.commands.size} commands loaded | ` +
        `${handlerSummary} | ` +
        `Database: ${databaseMode}`
      );


      /* =====================================================
         CRON
      ===================================================== */

      this.setupCronJobs();


    } catch (error) {

      logger.error(
        'Failed to start bot:',
        error
      );


      process.exit(1);

    }

  }


  /* =========================================================
     DISABLE SLASH COMMANDS
     ---------------------------------------------------------
     Xóa:
     
     1. Global Slash Commands
     2. Guild Slash Commands
     
     KHÔNG đăng ký lại.
  ========================================================= */

  async disableSlashCommands() {

    try {

      const applicationId =
        this.application?.id ||
        this.user?.id;


      if (!applicationId) {

        logger.warn(
          '⚠️ Không tìm thấy Application ID. Không thể xóa Slash Commands.'
        );

        return;

      }


      startupLog(
        '🧹 Removing old Slash Commands...'
      );


      /* =====================================================
         GLOBAL COMMANDS
      ===================================================== */

      try {

        await this.rest.put(

          Routes.applicationCommands(
            applicationId
          ),

          {
            body: [],
          }

        );


        startupLog(
          '✅ Global Slash Commands removed.'
        );


      } catch (error) {

        logger.error(
          '❌ Failed to remove Global Slash Commands:',
          error
        );

      }


      /* =====================================================
         GUILD COMMANDS
      ===================================================== */

      let guilds;


      try {

        guilds =
          await this.guilds.fetch();


        startupLog(
          `🔎 Found ${guilds.size} guild(s).`
        );


      } catch (error) {

        logger.error(
          '❌ Failed to fetch guilds:',
          error
        );

        return;

      }


      let successCount = 0;

      let failedCount = 0;


      for (
        const guild
        of guilds.values()
      ) {

        try {

          await this.rest.put(

            Routes.applicationGuildCommands(
              applicationId,
              guild.id
            ),

            {
              body: [],
            }

          );


          successCount++;


          logger.info(
            `✅ Slash Commands removed from ${guild.name} (${guild.id})`
          );


        } catch (error) {

          failedCount++;


          logger.error(
            `❌ Failed to remove Slash Commands from ${guild.name}:`,
            error
          );

        }

      }


      startupLog(
        `✅ Slash Commands disabled. ` +
        `Guilds: ${successCount} removed, ${failedCount} failed.`
      );


      logger.info(
        '🚫 Slash Command registration is disabled.'
      );


    } catch (error) {

      logger.error(
        '❌ Unexpected error while disabling Slash Commands:',
        error
      );

    }

  }


  /* =========================================================
     WEB SERVER
  ========================================================= */

  startWebServer() {

    const app =
      express();


    const configuredPort =
      Number(
        this.config.api?.port ||
        process.env.PORT ||
        3000
      );


    const maxPortRetryAttempts =
      Number(
        process.env.PORT_RETRY_ATTEMPTS ||
        5
      );


    const host =
      process.env.WEB_HOST ||
      '0.0.0.0';


    const corsOrigin =
      this.config.api?.cors?.origin ||
      '*';


    /* =====================================================
       CORS
    ===================================================== */

    app.use(
      (req, res, next) => {

        const allowedOrigins =
          Array.isArray(corsOrigin)
            ? corsOrigin
            : [corsOrigin];


        const origin =
          req.headers.origin;


        if (
          allowedOrigins.includes('*') ||
          allowedOrigins.includes(origin)
        ) {

          res.header(
            'Access-Control-Allow-Origin',
            origin || '*'
          );

        }


        res.header(
          'Access-Control-Allow-Methods',
          'GET, POST, OPTIONS'
        );


        res.header(
          'Access-Control-Allow-Headers',
          'Content-Type, Authorization'
        );


        if (
          req.method ===
          'OPTIONS'
        ) {

          return res.sendStatus(
            200
          );

        }


        next();

      }
    );


    /* =====================================================
       RATE LIMIT
    ===================================================== */

    const requestCounts =
      new Map();


    const windowMs =
      60000;


    const maxRequests =
      this.config.api?.rateLimit?.max ||
      100;


    app.use(
      (req, res, next) => {

        const ip =
          req.ip;


        const now =
          Date.now();


        const windowStart =
          now - windowMs;


        if (
          !requestCounts.has(ip)
        ) {

          requestCounts.set(
            ip,
            []
          );

        }


        const times =
          requestCounts
            .get(ip)
            .filter(
              time =>
                time >
                windowStart
            );


        if (
          times.length >=
          maxRequests
        ) {

          return res
            .status(429)
            .json({
              error:
                'Too many requests',
            });

        }


        times.push(
          now
        );


        requestCounts.set(
          ip,
          times
        );


        next();

      }
    );


    /* =====================================================
       HEALTH
    ===================================================== */

    app.get(
      '/health',
      (req, res) => {

        const dbStatus =
          this.db?.getStatus?.() || {
            isDegraded:
              'unknown',
            connectionType:
              'none',
          };


        res
          .status(200)
          .json({

            status:
              'healthy',

            timestamp:
              new Date()
                .toISOString(),

            uptime:
              process.uptime(),

            database: {

              connected:
                dbStatus.connectionType !==
                'none',

              degraded:
                dbStatus.isDegraded,

              type:
                dbStatus.connectionType,

            },

          });

      }
    );


    /* =====================================================
       READY
    ===================================================== */

    app.get(
      '/ready',
      (req, res) => {

        const dbStatus =
          this.db?.getStatus?.() || {

            isDegraded:
              true,

            connectionType:
              'none',

          };


        const isReady =
          this.isReady() &&
          !dbStatus.isDegraded;


        const metrics = {

          guildCount:
            this.guilds?.cache?.size ??
            0,

          commandCount:
            this.commands?.size ??
            0,

          database: {

            mode:
              dbStatus.connectionType,

            degraded:
              dbStatus.isDegraded,

            degradedReason:
              dbStatus.degradedReason ??
              null,

          },

          schemaVersion:
            EXPECTED_SCHEMA_VERSION,

          schemaLabel:
            EXPECTED_SCHEMA_LABEL,

        };


        if (isReady) {

          return res
            .status(200)
            .json({

              ready:
                true,

              message:
                'Bot is ready',

              metrics,

            });

        }


        return res
          .status(503)
          .json({

            ready:
              false,

            reason:
              !this.isReady()
                ? 'Bot not Ready'
                : 'Database degraded',

            metrics,

          });

      }
    );


    /* =====================================================
       ROOT
    ===================================================== */

    app.get(
      '/',
      (req, res) => {

        res
          .status(200)
          .json({

            message:
              'TitanBot System Online',

            version:
              pkg.version,

            timestamp:
              new Date()
                .toISOString(),

          });

      }
    );


    /* =====================================================
       START SERVER
    ===================================================== */

    const startServer =
      (
        port,
        attempt = 0
      ) => {

        let hasStartedListening =
          false;


        const server =
          app.listen(
            port,
            host,
            () => {

              hasStartedListening =
                true;


              this.webServer =
                server;


              startupLog(
                `✅ Web Server running on ${host}:${port}`
              );


              startupLog(
                `Health endpoint: http://${host}:${port}/health`
              );


              startupLog(
                `Ready endpoint: http://${host}:${port}/ready`
              );

            }
          );


        server.on(
          'error',
          error => {

            const errorCode =
              error?.code ||
              'UNKNOWN_ERROR';


            const errorMessage =
              error?.message ||
              'Unknown server error';


            /* =============================================
               PORT BUSY
            ============================================= */

            if (
              !hasStartedListening &&
              errorCode ===
              'EADDRINUSE' &&
              attempt <
              maxPortRetryAttempts
            ) {

              const nextPort =
                port + 1;


              startupLog(
                `Port ${port} is already in use. ` +
                `Trying port ${nextPort}...`
              );


              setTimeout(
                () =>
                  startServer(
                    nextPort,
                    attempt + 1
                  ),
                250
              );


              return;

            }


            /* =============================================
               DUPLICATE BIND
            ============================================= */

            if (
              hasStartedListening &&
              errorCode ===
              'EADDRINUSE'
            ) {

              logger.warn(
                `Web server duplicate bind warning on ${host}:${port}.`
              );


              return;

            }


            logger.error(
              `❌ Web server error on port ${port} ` +
              `(${errorCode}): ${errorMessage}`
            );


            if (
              !hasStartedListening
            ) {

              process.exit(1);

            }

          }
        );

      };


    startServer(
      configuredPort,
      0
    );

  }


  /* =========================================================
     CRON JOBS
  ========================================================= */

  setupCronJobs() {

    cron.schedule(
      '0 6 * * *',
      () =>
        checkBirthdays(
          this
        )
    );


    cron.schedule(
      '* * * * *',
      () =>
        checkGiveaways(
          this
        )
    );


    cron.schedule(
      '*/15 * * * *',
      () =>
        this.updateAllCounters()
    );

  }


  /* =========================================================
     UPDATE COUNTERS
  ========================================================= */

  async updateAllCounters() {

    if (!this.db) {

      logger.warn(
        'Database not available for counter updates'
      );

      return;

    }


    for (
      const [
        guildId,
        guild
      ]
      of this.guilds.cache
    ) {

      try {

        const counters =
          await getServerCounters(
            this,
            guildId
          );


        const validCounters =
          [];


        const orphanedCounters =
          [];


        for (
          const counter
          of counters
        ) {

          if (
            !counter ||
            !counter.type ||
            !counter.channelId ||
            counter.enabled === false
          ) {

            continue;

          }


          const channel =
            guild.channels.cache.get(
              counter.channelId
            );


          if (channel) {

            validCounters.push(
              counter
            );


            await updateCounter(
              this,
              guild,
              counter
            );

          } else {

            orphanedCounters.push(
              counter
            );


            logger.info(
              `Removing orphaned counter ${counter.id} ` +
              `(type: ${counter.type}, ` +
              `deleted channel: ${counter.channelId}) ` +
              `from guild ${guildId}`
            );

          }

        }


        /* ===============================================
           CLEAN ORPHANED COUNTERS
        =============================================== */

        if (
          orphanedCounters.length >
          0
        ) {

          await saveServerCounters(
            this,
            guildId,
            validCounters
          );


          logger.info(
            `Cleaned up ${orphanedCounters.length} ` +
            `orphaned counter(s) from guild ${guildId}`
          );

        }


      } catch (error) {

        logger.error(
          `Error updating counters for guild ${guildId}:`,
          error
        );

      }

    }

  }


  /* =========================================================
     LOAD HANDLERS
  ========================================================= */

  async loadHandlers() {

    startupLog(
      'Loading handlers...'
    );


    const handlers = [

      {
        path:
          'events',

        type:
          'default',

        required:
          true,
      },

      {
        path:
          'interactions',

        type:
          'default',

        required:
          true,
      },

    ];


    for (
      const handler
      of handlers
    ) {

      try {

        startupLog(
          `Loading handler: ${handler.path}`
        );


        const module =
          await import(
            `./handlers/${handler.path}.js`
          );


        const loaderFn =
          handler.type.startsWith(
            'named:'
          )

            ? module[
                handler.type.split(
                  ':'
                )[1]
              ]

            : module.default;


        if (
          typeof loaderFn !==
          'function'
        ) {

          throw new Error(
            `Invalid loader export from ${handler.path}`
          );

        }


        await loaderFn(
          this
        );


        startupLog(
          `✅ Loaded ${handler.path}`
        );


      } catch (error) {

        if (
          handler.required
        ) {

          logger.error(
            `❌ Failed to load required handler ${handler.path}:`,
            error
          );


          throw error;

        }


        if (
          error.code !==
          'MODULE_NOT_FOUND'
        ) {

          logger.warn(
            `⚠️ Failed to load optional handler ${handler.path}:`,
            error.message
          );

        }

      }

    }

  }


  /* =========================================================
     SHUTDOWN
  ========================================================= */

  async shutdown(
    reason = 'UNKNOWN'
  ) {

    shutdownLog(
      `Bot is shutting down (${reason})...`
    );


    logger.info(
      '\n' +
      '='.repeat(60)
    );


    logger.info(
      `🛑 Graceful Shutdown Initiated (${reason})`
    );


    logger.info(
      '='.repeat(60)
    );


    try {

      /* =====================================================
         STOP CRON
      ===================================================== */

      logger.info(
        'Stopping cron jobs...'
      );


      cron
        .getTasks()
        .forEach(
          task =>
            task.stop()
        );


      logger.info(
        '✅ Cron jobs stopped'
      );


      /* =====================================================
         DATABASE
      ===================================================== */

      if (
        this.db &&
        this.db.db
      ) {

        logger.info(
          'Closing database connection...'
        );


        try {

          if (
            this.db.db.pool
          ) {

            await this.db.db.pool.end();

            logger.info(
              '✅ Database connection closed'
            );

          }

        } catch (error) {

          logger.warn(
            'Error closing database pool:',
            error.message
          );

        }

      }


      /* =====================================================
         WEB SERVER
      ===================================================== */

      if (
        this.webServer
      ) {

        try {

          await new Promise(
            resolve =>
              this.webServer.close(
                () =>
                  resolve()
              )
          );


          logger.info(
            '✅ Web server closed'
          );

        } catch (error) {

          logger.warn(
            'Web server close warning:',
            error.message
          );

        }

      }


      /* =====================================================
         DISCORD
      ===================================================== */

      logger.info(
        'Destroying Discord client...'
      );


      if (
        this.isReady()
      ) {

        try {

          this.destroy();


          logger.info(
            '✅ Discord client destroyed'
          );


        } catch (error) {

          logger.warn(
            'Discord client destroy warning:',
            error.message
          );

        }

      }


      logger.info(
        '✅ Graceful shutdown complete'
      );


      shutdownLog(
        'Bot stopped successfully.'
      );


      process.exit(0);


    } catch (error) {

      logger.error(
        'Error during graceful shutdown:',
        error
      );


      process.exit(1);

    }

  }

}


/* =========================================================
   BOOTSTRAP
========================================================= */

try {

  const bot =
    new TitanBot();


  /* =======================================================
     SHUTDOWN HANDLERS
  ======================================================= */

  const setupShutdown =
    () => {

      process.on(
        'SIGTERM',
        () =>
          bot.shutdown(
            'SIGTERM'
          )
      );


      process.on(
        'SIGINT',
        () =>
          bot.shutdown(
            'SIGINT'
          )
      );


      /* ===================================================
         UNCAUGHT EXCEPTION
      =================================================== */

      process.on(
        'uncaughtException',
        error => {

          logger.error(
            'Uncaught Exception:',
            error
          );


          bot.shutdown(
            'UNCAUGHT_EXCEPTION'
          );

        }
      );


      /* ===================================================
         UNHANDLED REJECTION
      =================================================== */

      process.on(
        'unhandledRejection',
        (
          reason,
          promise
        ) => {

          const code =
            reason?.code;


          /*
           * Discord interaction errors
           * có thể bỏ qua.
           */

          if (
            code === 10062 ||
            code === 40060 ||
            code === 50027
          ) {

            logger.warn(
              'Recoverable Discord interaction rejection:',
              reason?.message ||
              reason
            );


            return;

          }


          logger.error(
            'Unhandled Rejection at:',
            promise,
            'reason:',
            reason
          );


          bot.shutdown(
            'UNHANDLED_REJECTION'
          );

        }
      );

    };


  setupShutdown();


  /* =======================================================
     START
  ======================================================= */

  bot.start()
    .catch(
      error => {

        logger.error(
          'Fatal error during bot startup:',
          error
        );


        bot.shutdown(
          'STARTUP_ERROR'
        );

      }
    );


} catch (error) {

  logger.error(
    'Fatal error during bot startup:',
    error
  );


  process.exit(1);

}


export default TitanBot;
