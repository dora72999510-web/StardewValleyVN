import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { logger } from '../utils/logger.js';

/* =========================================================
   CONFIG
========================================================= */

/*
 * Chỉ cho phép !lyric sử dụng trong một kênh cụ thể.
 *
 * Trong file .env:
 *
 * LYRIC_CHANNEL_ID=123456789012345678
 *
 * Nếu chưa cấu hình thì !lyric sẽ thông báo cho người dùng.
 */
const LYRIC_CHANNEL_ID =
  String(process.env.LYRIC_CHANNEL_ID || '').trim();


/*
 * LRCLIB API
 *
 * API tìm kiếm:
 * https://lrclib.net/api/search?q=...
 */
const LYRICS_API_URL =
  'https://lrclib.net/api/search';


/*
 * Timeout API.
 */
const API_TIMEOUT_MS = 10000;


/*
 * Discord Embed description tối đa 4096 ký tự.
 *
 * Để tránh vượt giới hạn, dùng khoảng 3800.
 */
const MAX_LYRICS_LENGTH = 3800;


/*
 * Giới hạn số phần lyrics gửi ra.
 *
 * Tránh trường hợp API trả về dữ liệu bất thường
 * khiến bot gửi quá nhiều message.
 */
const MAX_LYRICS_PAGES = 10;


/* =========================================================
   COMMAND
========================================================= */

const command = {

  /*
   * Prefix command.
   *
   * !lyric Ed Sheeran Shape of You
   */
  name: 'lyric',

  category: 'music',

  description:
    'Tìm lời bài hát',


  /*
   * Cho phép prefix adapter chạy command.
   */
  prefix: true,


  /*
   * Slash command data.
   *
   * Quan trọng:
   * loadCommands() của hệ thống bạn đang gọi:
   *
   * command.data.toJSON()
   *
   * nên phải dùng SlashCommandBuilder.
   */
  data: new SlashCommandBuilder()
    .setName('lyric')
    .setDescription('Tìm lời bài hát')
    .addStringOption(option =>
      option
        .setName('song')
        .setDescription('Tên bài hát hoặc ca sĩ + tên bài hát')
        .setRequired(true)
    ),


  /* =======================================================
     EXECUTE
     -------------------------------------------------------
     Tương thích với messageAdapter.js:

     execute(
       message,
       args,
       client
     )

     Ví dụ:

     !lyric Ed Sheeran Shape of You

     args sẽ là:

     [
       'Ed',
       'Sheeran',
       'Shape',
       'of',
       'You'
     ]
  ======================================================= */

  async execute(message, args, client) {

    try {

      /* =====================================================
         VALIDATE MESSAGE
      ===================================================== */

      if (!message) {

        logger.warn(
          '[LYRIC] Message không tồn tại.'
        );

        return;
      }


      if (!message.channel) {

        logger.warn(
          '[LYRIC] Message không có channel.'
        );

        return;
      }


      /* =====================================================
         CHANNEL RESTRICTION
      ===================================================== */

      if (!LYRIC_CHANNEL_ID) {

        await sendEmbed(
          message,
          {
            title: '⚙️ Lyric chưa được cấu hình',

            description: [
              'Admin chưa cấu hình kênh sử dụng lệnh `!lyric`.',
              '',
              'Hãy thêm vào file `.env`:',
              '```env',
              'LYRIC_CHANNEL_ID=ID_KENH_CUA_BAN',
              '```',
            ].join('\n'),

            color: 0xffa500,
          }
        );

        return;
      }


      if (
        message.channel.id !==
        LYRIC_CHANNEL_ID
      ) {

        await sendEmbed(
          message,
          {
            title: '🎵 Sai kênh sử dụng',

            description:
              `Lệnh \`!lyric\` chỉ được sử dụng tại <#${LYRIC_CHANNEL_ID}>.`,

            color: 0xffa500,
          }
        );

        return;
      }


      /* =====================================================
         NORMALIZE ARGS
      ===================================================== */

      const query =
        normalizeLyricsQuery(args);


      logger.debug?.(
        `[LYRIC] Normalized query: ${JSON.stringify(query)}`
      );


      /* =====================================================
         EMPTY QUERY
      ===================================================== */

      if (!query) {

        await sendEmbed(
          message,
          {
            title: '🎵 Cách sử dụng !lyric',

            description: [
              'Bạn chưa nhập tên bài hát.',
              '',
              '**Ví dụ:**',
              '`!lyric Shape of You`',
              '`!lyric Ed Sheeran Shape of You`',
              '',
              'Bạn nên nhập **tên ca sĩ + tên bài hát** để tìm chính xác hơn.',
            ].join('\n'),

            color: 0x5865f2,
          }
        );

        return;
      }


      /* =====================================================
         LOG
      ===================================================== */

      logger.info(
        `[LYRIC] ${message.author?.tag || 'Unknown'} searched: ${query}`
      );


      /* =====================================================
         LOADING MESSAGE
      ===================================================== */

      const loadingMessage =
        await message.channel
          .send({
            embeds: [
              new EmbedBuilder()
                .setTitle('🎵 Đang tìm bài hát...')
                .setDescription(
                  `Đang tìm **${escapeMarkdown(query)}**...`
                )
                .setColor(0x5865f2),
            ],
          })
          .catch(error => {

            logger.warn(
              '[LYRIC] Không thể gửi loading message:',
              error?.message || error
            );

            return null;
          });


      /* =====================================================
         SEARCH LRCLIB
      ===================================================== */

      const result =
        await searchLyrics(query);


      /* =====================================================
         NOT FOUND
      ===================================================== */

      if (!result) {

        await updateOrSend(
          message,
          loadingMessage,
          new EmbedBuilder()
            .setTitle('❌ Không tìm thấy bài hát')
            .setDescription(
              [
                `Không tìm thấy lyrics cho **${escapeMarkdown(query)}**.`,
                '',
                'Bạn có thể thử nhập cả **tên ca sĩ + tên bài hát**.',
                '',
                '**Ví dụ:**',
                '`!lyric Ed Sheeran Shape of You`',
                '`!lyric Adele Hello`',
              ].join('\n')
            )
            .setColor(0xed4245)
        );

        return;
      }


      /* =====================================================
         GET LYRICS
      ===================================================== */

      const lyrics =
        getLyricsText(result);


      if (!lyrics) {

        await updateOrSend(
          message,
          loadingMessage,
          new EmbedBuilder()
            .setTitle('❌ Không có lyrics')
            .setDescription(
              [
                `Đã tìm thấy **${escapeMarkdown(
                  result.trackName || query
                )}**.`,
                '',
                'Tuy nhiên API không trả về phần lời bài hát.',
                '',
                'Bạn có thể thử tìm lại bằng:',
                '`!lyric Tên ca sĩ Tên bài hát`',
              ].join('\n')
            )
            .setColor(0xed4245)
        );

        return;
      }


      /* =====================================================
         SPLIT LYRICS
      ===================================================== */

      let chunks =
        splitText(
          lyrics,
          MAX_LYRICS_LENGTH
        );


      /*
       * Không cho gửi quá nhiều trang.
       */
      if (
        chunks.length >
        MAX_LYRICS_PAGES
      ) {

        logger.warn(
          `[LYRIC] Lyrics quá dài (${chunks.length} pages), giới hạn ${MAX_LYRICS_PAGES} pages.`
        );

        chunks =
          chunks.slice(
            0,
            MAX_LYRICS_PAGES
          );
      }


      /* =====================================================
         SEND FIRST PAGE
      ===================================================== */

      const firstEmbed =
        createLyricsEmbed(
          result,
          chunks[0],
          1,
          chunks.length
        );


      if (loadingMessage) {

        await loadingMessage
          .edit({
            embeds: [
              firstEmbed,
            ],
          })
          .catch(error => {

            logger.warn(
              '[LYRIC] Không thể edit loading message:',
              error?.message || error
            );

          });

      } else {

        await message.channel
          .send({
            embeds: [
              firstEmbed,
            ],
          })
          .catch(error => {

            logger.warn(
              '[LYRIC] Không thể gửi lyrics:',
              error?.message || error
            );

          });
      }


      /* =====================================================
         SEND REMAINING PAGES
      ===================================================== */

      for (
        let index = 1;
        index < chunks.length;
        index++
      ) {

        const embed =
          createLyricsEmbed(
            result,
            chunks[index],
            index + 1,
            chunks.length
          );


        await message.channel
          .send({
            embeds: [
              embed,
            ],
          })
          .catch(error => {

            logger.warn(
              `[LYRIC] Không thể gửi trang ${index + 1}:`,
              error?.message || error
            );

          });
      }


      logger.info(
        `[LYRIC] Successfully returned lyrics for "${result.trackName || query}"`
      );

    } catch (error) {

      logger.error(
        '[LYRIC] Command error:',
        error
      );


      await sendEmbed(
        message,
        {
          title: '❌ Lỗi lyrics',

          description:
            'Đã xảy ra lỗi khi tìm lời bài hát. Vui lòng thử lại sau.',

          color: 0xed4245,
        }
      );

    }

  },

};


/* =========================================================
   SEARCH LYRICS
========================================================= */

async function searchLyrics(query) {

  if (
    typeof query !== 'string' ||
    !query.trim()
  ) {

    return null;
  }


  const controller =
    new AbortController();


  const timeout =
    setTimeout(
      () => {
        controller.abort();
      },
      API_TIMEOUT_MS
    );


  try {

    const url =
      new URL(
        LYRICS_API_URL
      );


    url.searchParams.set(
      'q',
      query.trim()
    );


    logger.debug?.(
      `[LYRIC] Requesting LRCLIB: ${url.toString()}`
    );


    const response =
      await fetch(
        url,
        {
          method: 'GET',

          headers: {
            Accept:
              'application/json',

            'User-Agent':
              'DiscordBot-Lyric/1.0',
          },

          signal:
            controller.signal,
        }
      );


    if (!response.ok) {

      logger.warn(
        `[LYRIC] LRCLIB returned HTTP ${response.status}`
      );

      return null;
    }


    const data =
      await response.json();


    if (
      !Array.isArray(data) ||
      data.length === 0
    ) {

      logger.info(
        `[LYRIC] No results for "${query}"`
      );

      return null;
    }


    /*
     * Ưu tiên:
     *
     * 1. Có plainLyrics
     * 2. Có syncedLyrics
     * 3. Kết quả đầu tiên
     */

    const withPlainLyrics =
      data.find(
        item =>
          typeof item?.plainLyrics === 'string' &&
          item.plainLyrics.trim().length > 0
      );


    if (withPlainLyrics) {
      return withPlainLyrics;
    }


    const withSyncedLyrics =
      data.find(
        item =>
          typeof item?.syncedLyrics === 'string' &&
          item.syncedLyrics.trim().length > 0
      );


    if (withSyncedLyrics) {
      return withSyncedLyrics;
    }


    return data[0] || null;

  } catch (error) {

    if (
      error?.name === 'AbortError'
    ) {

      logger.warn(
        `[LYRIC] LRCLIB timeout after ${API_TIMEOUT_MS}ms`
      );

    } else {

      logger.error(
        '[LYRIC] LRCLIB API error:',
        error
      );

    }


    return null;

  } finally {

    clearTimeout(
      timeout
    );
  }
}


/* =========================================================
   GET LYRICS TEXT
========================================================= */

function getLyricsText(result) {

  if (!result) {
    return '';
  }


  /*
   * LRCLIB thường trả:
   *
   * plainLyrics
   *
   * hoặc:
   *
   * syncedLyrics
   */


  if (
    typeof result.plainLyrics === 'string' &&
    result.plainLyrics.trim()
  ) {

    return cleanLyrics(
      result.plainLyrics
    );
  }


  if (
    typeof result.syncedLyrics === 'string' &&
    result.syncedLyrics.trim()
  ) {

    return cleanSyncedLyrics(
      result.syncedLyrics
    );
  }


  return '';
}


/* =========================================================
   CLEAN PLAIN LYRICS
========================================================= */

function cleanLyrics(text) {

  return String(text)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}


/* =========================================================
   CLEAN SYNCED LYRICS
========================================================= */

function cleanSyncedLyrics(text) {

  return String(text)
    .split(/\r?\n/)
    .map(line => {

      /*
       * Xóa timestamp:
       *
       * [00:12.34]
       * [01:02.123]
       * [01:02]
       */

      return line
        .replace(
          /^\s*\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]\s*/,
          ''
        )
        .trim();

    })
    .filter(Boolean)
    .join('\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}


/* =========================================================
   NORMALIZE QUERY
   ---------------------------------------------------------
   Tương thích với messageAdapter.js mới.
========================================================= */

function normalizeLyricsQuery(args) {

  /* -------------------------------------------------------
     Không có args
  ------------------------------------------------------- */

  if (
    args === undefined ||
    args === null
  ) {

    return '';
  }


  /* -------------------------------------------------------
     Array
     
     Đây là trường hợp bình thường:

     [
       'Ed',
       'Sheeran',
       'Shape',
       'of',
       'You'
     ]
  ------------------------------------------------------- */

  if (Array.isArray(args)) {

    return args
      .flatMap(
        value =>
          normalizeSingleArgument(value)
      )
      .filter(Boolean)
      .join(' ')
      .trim();
  }


  /* -------------------------------------------------------
     String
  ------------------------------------------------------- */

  if (
    typeof args === 'string'
  ) {

    return args.trim();
  }


  /* -------------------------------------------------------
     Object
     
     Fallback để command vẫn an toàn nếu một phần
     khác của bot truyền object.
  ------------------------------------------------------- */

  if (
    typeof args === 'object'
  ) {

    const keys = [
      'query',
      'song',
      'songName',
      'title',
      'search',
      'input',
      'text',
      'content',
      'value',
      'rawArgs',
    ];


    for (
      const key of keys
    ) {

      const value =
        args[key];


      if (
        typeof value === 'string' &&
        value.trim()
      ) {

        return value.trim();
      }


      if (
        Array.isArray(value)
      ) {

        const result =
          value
            .flatMap(
              item =>
                normalizeSingleArgument(item)
            )
            .filter(Boolean)
            .join(' ')
            .trim();


        if (result) {
          return result;
        }
      }
    }


    /*
     * args.args
     */

    if (
      args.args &&
      args.args !== args
    ) {

      return normalizeLyricsQuery(
        args.args
      );
    }


    /*
     * TUYỆT ĐỐI KHÔNG:
     *
     * return String(args)
     *
     * vì sẽ tạo:
     *
     * [object Object]
     */

    return '';
  }


  /* -------------------------------------------------------
     Primitive
  ------------------------------------------------------- */

  return String(args).trim();
}


/* =========================================================
   NORMALIZE SINGLE ARGUMENT
========================================================= */

function normalizeSingleArgument(value) {

  if (
    value === undefined ||
    value === null
  ) {

    return [];
  }


  if (
    typeof value === 'string'
  ) {

    return [
      value.trim(),
    ].filter(Boolean);
  }


  if (
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {

    return [
      String(value),
    ];
  }


  if (
    typeof value === 'object'
  ) {

    const keys = [
      'value',
      'name',
      'text',
      'content',
      'query',
      'input',
    ];


    for (
      const key of keys
    ) {

      if (
        typeof value[key] === 'string' &&
        value[key].trim()
      ) {

        return [
          value[key].trim(),
        ];
      }
    }


    return [];
  }


  return [];
}


/* =========================================================
   CREATE LYRICS EMBED
========================================================= */

function createLyricsEmbed(
  result,
  lyrics,
  page = 1,
  totalPages = 1
) {

  const trackName =
    result?.trackName ||
    'Không rõ tên bài hát';


  const artistName =
    result?.artistName ||
    'Không rõ ca sĩ';


  const albumName =
    result?.albumName ||
    '';


  const embed =
    new EmbedBuilder()
      .setTitle(
        `🎵 ${truncate(
          trackName,
          240
        )}`
      )
      .setDescription(
        lyrics
      )
      .setColor(
        0x5865f2
      );


  const footer = [];


  if (artistName) {

    footer.push(
      artistName
    );
  }


  if (albumName) {

    footer.push(
      albumName
    );
  }


  if (
    totalPages > 1
  ) {

    footer.push(
      `Trang ${page}/${totalPages}`
    );
  }


  if (
    footer.length > 0
  ) {

    embed.setFooter({
      text:
        footer.join(' • '),
    });
  }


  return embed;
}


/* =========================================================
   UPDATE OR SEND EMBED
========================================================= */

async function updateOrSend(
  message,
  loadingMessage,
  embed
) {

  if (loadingMessage) {

    const edited =
      await loadingMessage
        .edit({
          embeds: [
            embed,
          ],
        })
        .then(
          () => true
        )
        .catch(error => {

          logger.warn(
            '[LYRIC] Không thể edit loading message:',
            error?.message || error
          );

          return false;
        });


    if (edited) {
      return;
    }
  }


  await message.channel
    .send({
      embeds: [
        embed,
      ],
    })
    .catch(error => {

      logger.warn(
        '[LYRIC] Không thể gửi embed:',
        error?.message || error
      );

    });
}


/* =========================================================
   SEND EMBED
========================================================= */

async function sendEmbed(
  message,
  {
    title,
    description,
    color = 0x5865f2,
  }
) {

  if (
    !message?.channel
  ) {

    return null;
  }


  return message.channel
    .send({
      embeds: [
        new EmbedBuilder()
          .setTitle(title)
          .setDescription(description)
          .setColor(color),
      ],
    })
    .catch(error => {

      logger.warn(
        '[LYRIC] Không thể gửi embed:',
        error?.message || error
      );

      return null;
    });
}


/* =========================================================
   SPLIT TEXT
========================================================= */

function splitText(
  text,
  maxLength = 3800
) {

  const normalized =
    String(text || '')
      .trim();


  if (!normalized) {
    return [];
  }


  if (
    normalized.length <=
    maxLength
  ) {

    return [
      normalized,
    ];
  }


  const chunks = [];


  let remaining =
    normalized;


  while (
    remaining.length >
    maxLength
  ) {

    /*
     * Ưu tiên cắt tại newline.
     */

    let splitAt =
      remaining.lastIndexOf(
        '\n',
        maxLength
      );


    /*
     * Nếu newline quá gần đầu,
     * tìm space.
     */

    if (
      splitAt < 500
    ) {

      splitAt =
        remaining.lastIndexOf(
          ' ',
          maxLength
        );
    }


    /*
     * Nếu vẫn không tìm được,
     * cắt cứng.
     */

    if (
      splitAt <= 0
    ) {

      splitAt =
        maxLength;
    }


    const chunk =
      remaining
        .slice(
          0,
          splitAt
        )
        .trim();


    if (chunk) {

      chunks.push(
        chunk
      );
    }


    remaining =
      remaining
        .slice(
          splitAt
        )
        .trim();
  }


  if (remaining) {

    chunks.push(
      remaining
    );
  }


  return chunks;
}


/* =========================================================
   ESCAPE MARKDOWN
========================================================= */

function escapeMarkdown(text) {

  return String(
    text || ''
  )
    .replace(
      /[`*_~|>]/g,
      '\\$&'
    );
}


/* =========================================================
   TRUNCATE
========================================================= */

function truncate(
  text,
  maxLength
) {

  const value =
    String(
      text || ''
    );


  if (
    value.length <=
    maxLength
  ) {

    return value;
  }


  return (
    value.slice(
      0,
      maxLength - 3
    ) +
    '...'
  );
}


/* =========================================================
   EXPORT
========================================================= */

export default command;
