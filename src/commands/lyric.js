import { EmbedBuilder } from 'discord.js';
import { logger } from '../utils/logger.js';

/* =========================================================
   CONFIG
========================================================= */

/*
 * Chỉ cho phép !lyric sử dụng trong một kênh cụ thể.
 *
 * Trong .env:
 *
 * LYRIC_CHANNEL_ID=123456789012345678
 *
 * Nếu không khai báo LYRIC_CHANNEL_ID thì !lyric
 * sẽ được phép sử dụng ở mọi kênh.
 */
const LYRIC_CHANNEL_ID =
  String(process.env.LYRIC_CHANNEL_ID || '').trim() || null;


/*
 * LRCLIB API
 *
 * API này cho phép tìm kiếm bài hát và lyrics.
 */
const LYRICS_API_URL =
  'https://lrclib.net/api/search';


/*
 * Thời gian timeout API.
 */
const API_TIMEOUT_MS = 10000;


/*
 * Discord giới hạn description của Embed là 4096 ký tự.
 *
 * Để an toàn, dùng 3800.
 */
const MAX_LYRICS_CHUNK = 3800;


/* =========================================================
   COMMAND
========================================================= */

const command = {

  name: 'lyric',

  category: 'music',

  description: 'Tìm lời bài hát',

  /*
   * Prefix system của bot sử dụng client.commands.
   */
  data: {
    name: 'lyric',
    description: 'Tìm lời bài hát',
  },


  /* =======================================================
     EXECUTE
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

      if (
        LYRIC_CHANNEL_ID &&
        String(message.channel.id) !==
          LYRIC_CHANNEL_ID
      ) {

        await sendEmbed(
          message,
          {
            title: '🎵 Lyric',

            description:
              `Lệnh \`!lyric\` chỉ được sử dụng tại <#${LYRIC_CHANNEL_ID}>.`,

            color: 0xff9900,
          }
        );

        return;

      }


      /* =====================================================
         GET QUERY
      ===================================================== */

      const songQuery =
        extractLyricsQuery(
          args,
          message
        );


      /*
       * Nếu không có query thì hướng dẫn sử dụng.
       */

      if (!songQuery) {

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


      logger.info(
        `[LYRIC] ${message.author?.tag || 'Unknown'} searched: "${songQuery}"`
      );


      /* =====================================================
         LOADING
      ===================================================== */

      const loadingMessage =
        await message.channel
          .send({
            embeds: [
              new EmbedBuilder()
                .setTitle('🎵 Đang tìm lyrics...')
                .setDescription(
                  `Đang tìm lời bài hát **${escapeMarkdown(songQuery)}**...`
                )
                .setColor(0x5865f2),
            ],
          })
          .catch(() => null);


      /* =====================================================
         SEARCH
      ===================================================== */

      const result =
        await searchLyrics(
          songQuery
        );


      /* =====================================================
         NOT FOUND
      ===================================================== */

      if (!result) {

        const notFoundEmbed =
          new EmbedBuilder()
            .setTitle(
              '❌ Không tìm thấy bài hát'
            )
            .setDescription(
              [
                `Không tìm thấy lyrics cho **${escapeMarkdown(songQuery)}**.`,
                '',
                'Bạn có thể thử nhập cả **tên ca sĩ + tên bài hát**.',
                '',
                '**Ví dụ:**',
                '`!lyric Ed Sheeran Shape of You`',
              ].join('\n')
            )
            .setColor(0xed4245);


        if (loadingMessage) {

          await loadingMessage
            .edit({
              embeds: [
                notFoundEmbed,
              ],
            })
            .catch(() => {});

        } else {

          await message.channel
            .send({
              embeds: [
                notFoundEmbed,
              ],
            })
            .catch(() => {});

        }

        return;

      }


      /* =====================================================
         GET LYRICS
      ===================================================== */

      const lyrics =
        getLyricsText(
          result
        );


      if (!lyrics) {

        const noLyricsEmbed =
          new EmbedBuilder()
            .setTitle(
              '❌ Không có lyrics'
            )
            .setDescription(
              [
                `Đã tìm thấy **${escapeMarkdown(result.trackName || songQuery)}**.`,
                '',
                'Tuy nhiên API không trả về nội dung lyrics cho bài hát này.',
              ].join('\n')
            )
            .setColor(0xed4245);


        if (loadingMessage) {

          await loadingMessage
            .edit({
              embeds: [
                noLyricsEmbed,
              ],
            })
            .catch(() => {});

        } else {

          await message.channel
            .send({
              embeds: [
                noLyricsEmbed,
              ],
            })
            .catch(() => {});

        }

        return;

      }


      /* =====================================================
         SPLIT LYRICS
      ===================================================== */

      const chunks =
        splitText(
          lyrics,
          MAX_LYRICS_CHUNK
        );


      if (!chunks.length) {

        return;

      }


      /* =====================================================
         SINGLE EMBED
      ===================================================== */

      if (chunks.length === 1) {

        const embed =
          createLyricsEmbed(
            result,
            chunks[0]
          );


        if (loadingMessage) {

          await loadingMessage
            .edit({
              embeds: [
                embed,
              ],
            })
            .catch(() => {});

        } else {

          await message.channel
            .send({
              embeds: [
                embed,
              ],
            })
            .catch(() => {});

        }

        return;

      }


      /* =====================================================
         MULTIPLE EMBEDS
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
          .catch(() => {});

      } else {

        await message.channel
          .send({
            embeds: [
              firstEmbed,
            ],
          })
          .catch(() => {});

      }


      /*
       * Gửi những phần lyrics còn lại.
       */

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
              `[LYRIC] Không thể gửi phần lyrics ${index + 1}:`,
              error?.message || error
            );

          });

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
            title: '❌ Lỗi lyrics',

            description:
              'Đã xảy ra lỗi khi tìm lời bài hát. Vui lòng thử lại sau.',

            color: 0xed4245,
          }
        );

      } catch {
        // Không làm gì nếu không thể gửi lỗi.
      }

    }

  },

};


/* =========================================================
   EXTRACT LYRICS QUERY
   ---------------------------------------------------------
   Đây là phần quan trọng nhất.

   Hỗ trợ:

   !lyric Shape of You

   !lyric Ed Sheeran Shape of You

   Đồng thời xử lý các trường hợp adapter truyền:

   - Array
   - String
   - Object
   - Nested object
   - Collection-like object

   Tuyệt đối không biến object thành:
   [object Object]
========================================================= */

function extractLyricsQuery(
  args,
  message
) {

  /* =======================================================
     ARRAY
  ======================================================= */

  if (Array.isArray(args)) {

    const values =
      args
        .map(
          value =>
            extractArgumentValue(
              value
            )
        )
        .filter(Boolean);


    const query =
      values
        .join(' ')
        .trim();


    if (query) {

      return cleanQuery(
        query
      );

    }

  }


  /* =======================================================
     STRING
  ======================================================= */

  if (
    typeof args === 'string'
  ) {

    const query =
      cleanQuery(
        args
      );


    if (query) {

      return query;

    }

  }


  /* =======================================================
     OBJECT
  ======================================================= */

  if (
    args &&
    typeof args === 'object'
  ) {

    const query =
      extractFromObject(
        args
      );


    if (query) {

      return cleanQuery(
        query
      );

    }

  }


  /* =======================================================
     FALLBACK MESSAGE CONTENT
     -------------------------------------------------------
     Chỉ dùng nếu message.content thực sự bắt đầu
     bằng !lyric.
  ======================================================= */

  const content =
    typeof message?.content === 'string'
      ? message.content.trim()
      : '';


  if (content) {

    const match =
      content.match(
        /^!lyric(?:\s+([\s\S]+))?$/i
      );


    if (match?.[1]) {

      return cleanQuery(
        match[1]
      );

    }

  }


  return '';

}


/* =========================================================
   EXTRACT FROM OBJECT
========================================================= */

function extractFromObject(
  object
) {

  if (!object) {

    return '';

  }


  /*
   * Không bao giờ sử dụng:
   *
   * String(object)
   *
   * vì nó tạo:
   *
   * [object Object]
   */


  const directKeys = [

    'query',

    'song',

    'songName',

    'songTitle',

    'title',

    'search',

    'searchQuery',

    'input',

    'text',

    'content',

    'value',

  ];


  /* =======================================================
     DIRECT VALUES
  ======================================================= */

  for (
    const key
    of directKeys
  ) {

    if (
      !Object.prototype.hasOwnProperty.call(
        object,
        key
      )
    ) {

      continue;

    }


    const value =
      object[key];


    const extracted =
      extractArgumentValue(
        value
      );


    if (extracted) {

      return extracted;

    }

  }


  /* =======================================================
     NESTED ARGS
  ======================================================= */

  const nestedKeys = [

    'args',

    'arguments',

    'params',

    'parameters',

    'options',

  ];


  for (
    const key
    of nestedKeys
  ) {

    if (
      !Object.prototype.hasOwnProperty.call(
        object,
        key
      )
    ) {

      continue;

    }


    const value =
      object[key];


    if (
      Array.isArray(value)
    ) {

      const extracted =
        value
          .map(
            item =>
              extractArgumentValue(
                item
              )
          )
          .filter(Boolean)
          .join(' ')
          .trim();


      if (extracted) {

        return extracted;

      }

    }


    if (
      typeof value === 'string'
    ) {

      const extracted =
        cleanQuery(
          value
        );


      if (extracted) {

        return extracted;

      }

    }


    if (
      value &&
      typeof value === 'object'
    ) {

      const extracted =
        extractFromObject(
          value
        );


      if (extracted) {

        return extracted;

      }

    }

  }


  /* =======================================================
     COMMAND / INPUT
  ======================================================= */

  if (
    typeof object.command === 'string'
  ) {

    return object.command.trim();

  }


  return '';

}


/* =========================================================
   EXTRACT ONE ARGUMENT
========================================================= */

function extractArgumentValue(
  value
) {

  if (
    value === null ||
    value === undefined
  ) {

    return '';

  }


  if (
    typeof value === 'string'
  ) {

    return value.trim();

  }


  if (
    typeof value === 'number'
  ) {

    return String(
      value
    );

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

      'song',

      'title',

    ];


    for (
      const key
      of keys
    ) {

      const nestedValue =
        value[key];


      if (
        typeof nestedValue === 'string' &&
        nestedValue.trim()
      ) {

        return nestedValue.trim();

      }

    }


    /*
     * Nếu object chứa args.
     */

    if (
      Array.isArray(
        value.args
      )
    ) {

      return value.args
        .map(
          item =>
            extractArgumentValue(
              item
            )
        )
        .filter(Boolean)
        .join(' ')
        .trim();

    }


    return '';

  }


  return '';

}


/* =========================================================
   CLEAN QUERY
========================================================= */

function cleanQuery(
  query
) {

  if (
    typeof query !== 'string'
  ) {

    return '';

  }


  let value =
    query
      .replace(/\r/g, ' ')
      .replace(/\n/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();


  /*
   * Loại bỏ !lyric nếu adapter truyền cả command.
   *
   * Ví dụ:
   *
   * "!lyric Shape of You"
   *
   * -> "Shape of You"
   */

  value =
    value.replace(
      /^!lyric\b\s*/i,
      ''
    );


  /*
   * Không cho phép những giá trị lỗi phổ biến
   * lọt xuống API.
   */

  if (
    !value ||
    value === '[object Object]' ||
    value === 'undefined' ||
    value === 'null'
  ) {

    return '';

  }


  return value.trim();

}


/* =========================================================
   SEARCH LRCLIB
========================================================= */

async function searchLyrics(
  query
) {

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
        () => {
          controller.abort();
        },
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

      return null;

    }


    /*
     * Chỉ lấy những kết quả thực sự có lyrics.
     */

    const validResults =
      data.filter(
        item =>
          (
            typeof item?.plainLyrics === 'string' &&
            item.plainLyrics.trim()
          ) ||
          (
            typeof item?.syncedLyrics === 'string' &&
            item.syncedLyrics.trim()
          )
      );


    if (
      validResults.length === 0
    ) {

      return null;

    }


    /*
     * Ưu tiên exact-ish match.
     */

    const normalizedQuery =
      normalizeForComparison(
        query
      );


    const exactResult =
      validResults.find(
        item => {

          const track =
            normalizeForComparison(
              item.trackName || ''
            );

          const artist =
            normalizeForComparison(
              item.artistName || ''
            );

          return (
            normalizedQuery.includes(track) ||
            normalizedQuery.includes(artist + ' ' + track)
          );

        }
      );


    if (exactResult) {

      return exactResult;

    }


    /*
     * Nếu không có exact match,
     * lấy kết quả đầu tiên có lyrics.
     */

    return validResults[0] || null;

  } catch (error) {

    if (
      error?.name === 'AbortError'
    ) {

      logger.warn(
        '[LYRIC] LRCLIB API timeout.'
      );

    } else {

      logger.error(
        '[LYRIC] LRCLIB API error:',
        error
      );

    }


    return null;

  }

}


/* =========================================================
   NORMALIZE COMPARISON
========================================================= */

function normalizeForComparison(
  value
) {

  return String(
    value || ''
  )
    .normalize('NFD')
    .replace(
      /[\u0300-\u036f]/g,
      ''
    )
    .toLowerCase()
    .replace(
      /[^a-z0-9]+/g,
      ' '
    )
    .replace(
      /\s+/g,
      ' '
    )
    .trim();

}


/* =========================================================
   GET LYRICS TEXT
========================================================= */

function getLyricsText(
  result
) {

  if (!result) {

    return '';

  }


  /*
   * Ưu tiên plainLyrics.
   */

  if (
    typeof result.plainLyrics === 'string' &&
    result.plainLyrics.trim()
  ) {

    return cleanLyrics(
      result.plainLyrics
    );

  }


  /*
   * Fallback syncedLyrics.
   */

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
   CLEAN LYRICS
========================================================= */

function cleanLyrics(
  text
) {

  return String(
    text || ''
  )
    .replace(
      /\r\n/g,
      '\n'
    )
    .replace(
      /\r/g,
      '\n'
    )
    .replace(
      /\n{4,}/g,
      '\n\n\n'
    )
    .trim();

}


/* =========================================================
   CLEAN SYNCED LYRICS
========================================================= */

function cleanSyncedLyrics(
  text
) {

  return String(
    text || ''
  )
    .split(/\r?\n/)
    .map(
      line =>
        line
          .replace(
            /^\s*\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]\s*/,
            ''
          )
          .trim()
    )
    .filter(Boolean)
    .join('\n')
    .trim();

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


  const footerParts = [];


  if (artistName) {

    footerParts.push(
      artistName
    );

  }


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


  if (
    footerParts.length > 0
  ) {

    embed.setFooter({
      text:
        footerParts.join(
          ' • '
        ),
    });

  }


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
          .setTitle(
            title
          )
          .setDescription(
            description
          )
          .setColor(
            color
          ),
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
  maxLength = MAX_LYRICS_CHUNK
) {

  const normalized =
    String(
      text || ''
    )
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
     * Ưu tiên cắt tại xuống dòng.
     */

    let splitAt =
      remaining.lastIndexOf(
        '\n',
        maxLength
      );


    /*
     * Nếu xuống dòng quá gần đầu,
     * tìm khoảng trắng.
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
     * Nếu vẫn không có,
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
