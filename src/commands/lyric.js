import { EmbedBuilder } from 'discord.js';
import { logger } from '../utils/logger.js';

/* =========================================================
   CONFIG
========================================================= */

// Chỉ cho phép !lyric hoạt động trong kênh này.
// Thay ID bên dưới bằng ID kênh của bạn.
//
// Nếu muốn cho phép ở mọi kênh:
// const LYRIC_CHANNEL_ID = null;

const LYRIC_CHANNEL_ID =
  process.env.LYRIC_CHANNEL_ID || null;


// API lyrics
const LYRICS_API_URL =
  'https://lrclib.net/api/search';


// Timeout gọi API
const API_TIMEOUT_MS = 10000;


/* =========================================================
   COMMAND
========================================================= */

const command = {

  name: 'lyric',

  category: 'music',

  description:
    'Tìm lời bài hát',


  /*
   * Cho phép hệ thống prefix của bot nhận:
   *
   * !lyric Shape of You
   * !lyric Ed Sheeran Shape of You
   */

  data: {

    name: 'lyric',

    description:
      'Tìm lời bài hát',

  },


  /*
   * Quan trọng:
   *
   * Prefix system của bot sử dụng:
   *
   * supportsPrefixExecution()
   * executePrefixCommand()
   *
   * nên command phải có execute().
   */

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


      /* =====================================================
         CHANNEL RESTRICTION
      ===================================================== */

      if (
        LYRIC_CHANNEL_ID &&
        message.channel?.id !== LYRIC_CHANNEL_ID
      ) {

        await sendEmbed(
          message,
          {
            title:
              '🎵 Lyric',

            description:
              `Lệnh \`!lyric\` chỉ được sử dụng tại <#${LYRIC_CHANNEL_ID}>.`,

            color:
              0xff9900,
          }
        );

        return;

      }


      /* =====================================================
         NORMALIZE QUERY
      ===================================================== */

      const songName =
        normalizeLyricsQuery(args);


      /*
       * Nếu không có tên bài hát.
       */

      if (!songName) {

        await sendEmbed(
          message,
          {
            title:
              '🎵 Cách sử dụng !lyric',

            description:
              [
                'Bạn chưa nhập tên bài hát.',
                '',
                '**Ví dụ:**',
                '`!lyric Shape of You`',
                '`!lyric Ed Sheeran Shape of You`',
              ].join('\n'),

            color:
              0x5865f2,
          }
        );

        return;

      }


      logger.info(
        `[LYRIC] ${message.author?.tag || 'Unknown'} searched: ${songName}`
      );


      /* =====================================================
         LOADING MESSAGE
      ===================================================== */

      const loadingMessage =
        await message.channel
          .send({
            embeds: [
              new EmbedBuilder()
                .setTitle('🎵 Đang tìm lyrics...')
                .setDescription(
                  `Đang tìm lời bài hát **${escapeMarkdown(songName)}**...`
                )
                .setColor(0x5865f2),
            ],
          })
          .catch(() => null);


      /* =====================================================
         SEARCH API
      ===================================================== */

      const result =
        await searchLyrics(songName);


      /* =====================================================
         NOT FOUND
      ===================================================== */

      if (!result) {

        if (loadingMessage) {

          await loadingMessage
            .edit({
              embeds: [
                new EmbedBuilder()
                  .setTitle('❌ Không tìm thấy bài hát')
                  .setDescription(
                    [
                      `Không tìm thấy lyrics cho **${escapeMarkdown(songName)}**.`,
                      '',
                      'Bạn có thể thử nhập cả **tên ca sĩ + tên bài hát**.',
                      '',
                      '**Ví dụ:**',
                      '`!lyric Ed Sheeran Shape of You`',
                    ].join('\n')
                  )
                  .setColor(0xed4245),
              ],
            })
            .catch(() => {});

        } else {

          await sendEmbed(
            message,
            {
              title:
                '❌ Không tìm thấy bài hát',

              description:
                [
                  `Không tìm thấy lyrics cho **${escapeMarkdown(songName)}**.`,
                  '',
                  'Bạn có thể thử nhập cả **tên ca sĩ + tên bài hát**.',
                  '',
                  '**Ví dụ:**',
                  '`!lyric Ed Sheeran Shape of You`',
                ].join('\n'),

              color:
                0xed4245,
            }
          );

        }

        return;

      }


      /* =====================================================
         BUILD LYRICS
      ===================================================== */

      const lyrics =
        getLyricsText(result);


      if (!lyrics) {

        if (loadingMessage) {

          await loadingMessage
            .edit({
              embeds: [
                new EmbedBuilder()
                  .setTitle('❌ Không có lyrics')
                  .setDescription(
                    `Tìm thấy **${escapeMarkdown(result.trackName || songName)}** nhưng API không trả về lời bài hát.`
                  )
                  .setColor(0xed4245),
              ],
            })
            .catch(() => {});

        }

        return;

      }


      /* =====================================================
         DISCORD EMBED LIMIT
      ===================================================== */

      const chunks =
        splitText(lyrics, 3800);


      /*
       * Nếu lyrics ngắn:
       * gửi một embed.
       */

      if (chunks.length === 1) {

        const embed =
          createLyricsEmbed(
            result,
            chunks[0]
          );


        if (loadingMessage) {

          await loadingMessage
            .edit({
              embeds: [embed],
            })
            .catch(() => {});

        } else {

          await message.channel
            .send({
              embeds: [embed],
            })
            .catch(() => {});

        }

        return;

      }


      /* =====================================================
         LONG LYRICS
      ===================================================== */

      /*
       * Discord Embed description có giới hạn.
       *
       * Chia lyrics thành nhiều message.
       */

      if (loadingMessage) {

        await loadingMessage
          .edit({
            embeds: [
              createLyricsEmbed(
                result,
                chunks[0],
                1,
                chunks.length
              ),
            ],
          })
          .catch(() => {});

      } else {

        await message.channel
          .send({
            embeds: [
              createLyricsEmbed(
                result,
                chunks[0],
                1,
                chunks.length
              ),
            ],
          })
          .catch(() => {});

      }


      /*
       * Gửi các phần còn lại.
       */

      for (
        let index = 1;
        index < chunks.length;
        index++
      ) {

        await message.channel
          .send({
            embeds: [
              createLyricsEmbed(
                result,
                chunks[index],
                index + 1,
                chunks.length
              ),
            ],
          })
          .catch(() => {});

      }


    } catch (error) {

      logger.error(
        '[LYRIC] Command error:',
        error
      );


      try {

        await sendEmbed(
          message,
          {
            title:
              '❌ Lỗi lyrics',

            description:
              'Đã xảy ra lỗi khi tìm lời bài hát. Vui lòng thử lại sau.',

            color:
              0xed4245,
          }
        );

      } catch {
        // Không làm gì nếu không thể gửi lỗi.
      }

    }

  },

};


/* =========================================================
   SEARCH LYRICS
========================================================= */

async function searchLyrics(query) {

  try {

    const url =
      new URL(
        LYRICS_API_URL
      );


    url.searchParams.set(
      'q',
      query
    );


    const controller =
      new AbortController();


    const timeout =
      setTimeout(
        () =>
          controller.abort(),
        API_TIMEOUT_MS
      );


    let response;


    try {

      response =
        await fetch(
          url,
          {
            method: 'GET',

            headers: {
              Accept:
                'application/json',

              'User-Agent':
                'TitanBot/1.0',
            },

            signal:
              controller.signal,
          }
        );

    } finally {

      clearTimeout(
        timeout
      );

    }


    if (!response.ok) {

      logger.warn(
        `[LYRIC] API returned HTTP ${response.status}`
      );

      return null;

    }


    const data =
      await response.json();


    if (
      !Array.isArray(data) ||
      data.length === 0
    ) {

      return null;

    }


    /*
     * Ưu tiên kết quả có lyrics.
     */

    const result =
      data.find(
        item =>
          typeof item?.plainLyrics === 'string' &&
          item.plainLyrics.trim().length > 0
      ) ||
      data.find(
        item =>
          typeof item?.syncedLyrics === 'string' &&
          item.syncedLyrics.trim().length > 0
      ) ||
      data[0];


    return result || null;


  } catch (error) {

    if (
      error?.name ===
      'AbortError'
    ) {

      logger.warn(
        '[LYRIC] Lyrics API timeout.'
      );

    } else {

      logger.error(
        '[LYRIC] Lyrics API error:',
        error
      );

    }


    return null;

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
   * LRCLIB trả về plainLyrics
   * và đôi khi có syncedLyrics.
   *
   * Ưu tiên plainLyrics vì dễ hiển thị.
   */

  if (
    typeof result.plainLyrics ===
      'string' &&
    result.plainLyrics.trim()
  ) {

    return cleanLyrics(
      result.plainLyrics
    );

  }


  /*
   * Fallback:
   * chuyển synced lyrics thành text bình thường.
   */

  if (
    typeof result.syncedLyrics ===
      'string' &&
    result.syncedLyrics.trim()
  ) {

    return cleanSyncedLyrics(
      result.syncedLyrics
    );

  }


  return '';

}


/* =========================================================
   CLEAN LYRICS
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
       * Xóa timestamp dạng:
       *
       * [00:12.34]
       * [01:02.123]
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
    .trim();

}


/* =========================================================
   NORMALIZE QUERY
   ---------------------------------------------------------
   QUAN TRỌNG:
   Đây là phần sửa lỗi [object Object].
========================================================= */

function normalizeLyricsQuery(args) {

  /*
   * Không có args.
   */

  if (
    args === null ||
    args === undefined
  ) {

    return '';

  }


  /*
   * Trường hợp bình thường:
   *
   * ['Ed', 'Sheeran', 'Shape', 'of', 'You']
   */

  if (
    Array.isArray(args)
  ) {

    return args
      .map(
        value =>
          normalizeArgumentValue(
            value
          )
      )
      .filter(Boolean)
      .join(' ')
      .trim();

  }


  /*
   * Trường hợp adapter truyền object:
   *
   * {
   *   query: 'Ed Sheeran Shape of You'
   * }
   *
   * hoặc:
   *
   * {
   *   args: [...]
   * }
   */

  if (
    typeof args ===
    'object'
  ) {

    /*
     * Ưu tiên các property có khả năng
     * chứa nội dung command.
     */

    const directKeys = [
      'query',
      'song',
      'songName',
      'title',
      'search',
      'input',
      'text',
      'content',
      'value',
    ];


    for (
      const key
      of directKeys
    ) {

      const value =
        args[key];


      if (
        typeof value ===
          'string' &&
        value.trim()
      ) {

        return value.trim();

      }


      if (
        Array.isArray(value)
      ) {

        const normalized =
          value
            .map(
              item =>
                normalizeArgumentValue(
                  item
                )
            )
            .filter(Boolean)
            .join(' ')
            .trim();


        if (normalized) {

          return normalized;

        }

      }

    }


    /*
     * Một số adapter dùng:
     *
     * args.args
     */

    const nestedKeys = [
      'args',
      'arguments',
      'params',
      'parameters',
    ];


    for (
      const key
      of nestedKeys
    ) {

      const value =
        args[key];


      if (
        Array.isArray(value)
      ) {

        const normalized =
          value
            .map(
              item =>
                normalizeArgumentValue(
                  item
                )
            )
            .filter(Boolean)
            .join(' ')
            .trim();


        if (normalized) {

          return normalized;

        }

      }


      if (
        typeof value ===
          'string' &&
        value.trim()
      ) {

        return value.trim();

      }

    }


    /*
     * Trường hợp object có command string.
     */

    if (
      typeof args.command ===
        'string' &&
      args.command.trim()
    ) {

      return args.command.trim();

    }


    /*
     * Không stringify object.
     *
     * Đây chính là nguyên nhân tạo:
     *
     * [object Object]
     */

    return '';

  }


  /*
   * String / number / primitive.
   */

  return String(
    args
  ).trim();

}


/* =========================================================
   NORMALIZE ONE ARGUMENT
========================================================= */

function normalizeArgumentValue(value) {

  if (
    value === null ||
    value === undefined
  ) {

    return '';

  }


  if (
    typeof value ===
    'string'
  ) {

    return value.trim();

  }


  if (
    typeof value ===
    'number'
  ) {

    return String(value);

  }


  /*
   * Nếu một argument lại là object,
   * cố lấy giá trị thực thay vì [object Object].
   */

  if (
    typeof value ===
    'object'
  ) {

    const keys = [
      'value',
      'name',
      'text',
      'content',
      'query',
    ];


    for (
      const key
      of keys
    ) {

      if (
        typeof value[key] ===
          'string' &&
        value[key].trim()
      ) {

        return value[key].trim();

      }

    }


    return '';

  }


  return String(
    value
  ).trim();

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
    result?.albumName;


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


  /*
   * Footer.
   */

  const footerParts = [
    artistName,
  ];


  if (albumName) {

    footerParts.push(
      albumName
    );

  }


  if (
    totalPages > 1
  ) {

    footerParts.push(
      `Trang ${page}/${totalPages}`
    );

  }


  embed.setFooter({
    text:
      footerParts.join(
        ' • '
      ),
  });


  return embed;

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
        error?.message ||
        error
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

    let splitAt =
      remaining.lastIndexOf(
        '\n',
        maxLength
      );


    /*
     * Không tìm được xuống dòng,
     * tìm khoảng trắng.
     */

    if (
      splitAt < 1000
    ) {

      splitAt =
        remaining.lastIndexOf(
          ' ',
          maxLength
        );

    }


    /*
     * Vẫn không tìm được,
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

function escapeMarkdown(
  text
) {

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
