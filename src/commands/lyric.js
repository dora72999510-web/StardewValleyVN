import {
  EmbedBuilder,
  SlashCommandBuilder,
} from 'discord.js';

import { logger } from '../utils/logger.js';


/* =========================================================
   CONFIG
========================================================= */

/*
 * Kênh duy nhất được phép dùng !lyric
 */
const LYRIC_CHANNEL_ID =
  '1537723665754357780';


/*
 * LRCLIB API
 */
const LYRICS_API_URL =
  'https://lrclib.net/api/search';


/*
 * API timeout
 */
const API_TIMEOUT_MS = 10000;


/*
 * Discord Embed description tối đa 4096 ký tự.
 */
const MAX_LYRICS_LENGTH = 3800;


/*
 * Số trang lyrics tối đa.
 */
const MAX_LYRICS_PAGES = 10;


/* =========================================================
   COMMAND
========================================================= */

const command = {

  name: 'lyric',

  category: 'music',

  description: 'Tìm lời bài hát',

  /*
   * Rất quan trọng.
   *
   * messageAdapter.js kiểm tra prefix === false
   * mới chặn command.
   */
  prefix: true,


  /*
   * Slash command vẫn được giữ lại.
   */
  data:
    new SlashCommandBuilder()
      .setName('lyric')
      .setDescription('Tìm lời bài hát')
      .addStringOption(
        option =>
          option
            .setName('song')
            .setDescription(
              'Tên bài hát hoặc ca sĩ + tên bài hát'
            )
            .setRequired(true)
      ),


  /* =======================================================
     EXECUTE PREFIX
     =======================================================

     messageAdapter.js của bạn gọi:

       execute(
         message,
         normalizedArgs,
         client
       );

     Vì vậy:

       message = Discord Message
       args    = ['Ed', 'Sheeran', 'Shape', 'of', 'You']
       client  = Discord Client
  ======================================================= */

  async execute(
    message,
    args,
    client
  ) {

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
         CHANNEL CHECK
      ===================================================== */

      /*
       * Chỉ cho phép !lyric ở:
       *
       * 1537723665754357780
       */

      if (
        String(message.channel.id) !==
        LYRIC_CHANNEL_ID
      ) {

        await sendEmbed(
          message,
          {
            title:
              '🎵 Sai kênh sử dụng',

            description:
              [
                'Lệnh `!lyric` chỉ được sử dụng tại:',
                '',
                `<#${LYRIC_CHANNEL_ID}>`,
              ].join('\n'),

            color:
              0xffa500,
          }
        );

        return;
      }


      /* =====================================================
         NORMALIZE QUERY
      ===================================================== */

      /*
       * messageAdapter.js đã đảm bảo args là Array.
       *
       * Ví dụ:
       *
       * !lyric Ed Sheeran Shape of You
       *
       * args =
       *
       * [
       *   'Ed',
       *   'Sheeran',
       *   'Shape',
       *   'of',
       *   'You'
       * ]
       */

      const query =
        normalizeQuery(args);


      logger.info(
        `[LYRIC] Query: "${query}"`
      );


      /* =====================================================
         EMPTY QUERY
      ===================================================== */

      if (!query) {

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
                '`!lyric Adele Hello`',
              ].join('\n'),

            color:
              0x5865f2,
          }
        );

        return;
      }


      /* =====================================================
         LOADING
      ===================================================== */

      const loadingMessage =
        await sendLoading(
          message,
          query
        );


      /* =====================================================
         SEARCH
      ===================================================== */

      const result =
        await searchLyrics(
          query
        );


      /* =====================================================
         NOT FOUND
      ===================================================== */

      if (!result) {

        const embed =
          new EmbedBuilder()
            .setTitle(
              '❌ Không tìm thấy bài hát'
            )
            .setDescription(
              [
                `Không tìm thấy lyrics cho **${escapeMarkdown(query)}**.`,
                '',
                'Hãy thử nhập cả tên ca sĩ và tên bài hát.',
                '',
                '**Ví dụ:**',
                '`!lyric Ed Sheeran Shape of You`',
                '`!lyric Adele Hello`',
              ].join('\n')
            )
            .setColor(
              0xed4245
            );


        await editOrSend(
          message,
          loadingMessage,
          embed
        );

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

        const embed =
          new EmbedBuilder()
            .setTitle(
              '❌ Không có lyrics'
            )
            .setDescription(
              [
                `Đã tìm thấy **${escapeMarkdown(
                  result.trackName ||
                  query
                )}**.`,
                '',
                'Nhưng LRCLIB không trả về phần lời bài hát.',
                '',
                'Hãy thử tìm bằng tên ca sĩ + tên bài hát.',
              ].join('\n')
            )
            .setColor(
              0xed4245
            );


        await editOrSend(
          message,
          loadingMessage,
          embed
        );

        return;
      }


      /* =====================================================
         SPLIT
      ===================================================== */

      let chunks =
        splitText(
          lyrics,
          MAX_LYRICS_LENGTH
        );


      if (!chunks.length) {

        const embed =
          new EmbedBuilder()
            .setTitle(
              '❌ Lyrics rỗng'
            )
            .setDescription(
              'Không có nội dung lyrics để hiển thị.'
            )
            .setColor(
              0xed4245
            );


        await editOrSend(
          message,
          loadingMessage,
          embed
        );

        return;
      }


      /* =====================================================
         LIMIT PAGES
      ===================================================== */

      if (
        chunks.length >
        MAX_LYRICS_PAGES
      ) {

        logger.warn(
          `[LYRIC] Lyrics quá dài: ${chunks.length} pages`
        );

        chunks =
          chunks.slice(
            0,
            MAX_LYRICS_PAGES
          );
      }


      /* =====================================================
         FIRST PAGE
      ===================================================== */

      const firstEmbed =
        createLyricsEmbed(
          result,
          chunks[0],
          1,
          chunks.length
        );


      await editOrSend(
        message,
        loadingMessage,
        firstEmbed
      );


      /* =====================================================
         OTHER PAGES
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
          .catch(
            error => {

              logger.warn(
                `[LYRIC] Không thể gửi page ${index + 1}:`,
                error?.message ||
                error
              );
            }
          );
      }


      /* =====================================================
         SUCCESS
      ===================================================== */

      logger.info(
        `[LYRIC] Successfully returned "${result.trackName || query}"`
      );

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

      } catch (sendError) {

        logger.error(
          '[LYRIC] Không thể gửi error message:',
          sendError
        );
      }
    }
  },
};


/* =========================================================
   NORMALIZE QUERY
========================================================= */

function normalizeQuery(args) {

  /*
   * messageAdapter.js hiện tại đã truyền Array.
   */

  if (
    Array.isArray(args)
  ) {

    return args
      .map(
        value =>
          normalizeArgument(value)
      )
      .filter(Boolean)
      .join(' ')
      .trim();
  }


  /*
   * Fallback nếu command được gọi
   * trực tiếp bằng String.
   */

  if (
    typeof args === 'string'
  ) {

    return args.trim();
  }


  /*
   * Fallback object để tránh
   * [object Object].
   */

  if (
    args &&
    typeof args === 'object'
  ) {

    const keys = [
      'query',
      'song',
      'songName',
      'title',
      'text',
      'content',
      'input',
      'value',
    ];


    for (
      const key of keys
    ) {

      if (
        typeof args[key] === 'string' &&
        args[key].trim()
      ) {

        return args[key].trim();
      }
    }


    if (
      Array.isArray(args.args)
    ) {

      return normalizeQuery(
        args.args
      );
    }


    return '';
  }


  return '';
}


/* =========================================================
   NORMALIZE ARGUMENT
========================================================= */

function normalizeArgument(value) {

  if (
    value === undefined ||
    value === null
  ) {

    return '';
  }


  if (
    typeof value === 'string'
  ) {

    return value.trim();
  }


  if (
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {

    return String(value);
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
      'song',
      'title',
    ];


    for (
      const key of keys
    ) {

      if (
        typeof value[key] === 'string' &&
        value[key].trim()
      ) {

        return value[key].trim();
      }
    }


    return '';
  }


  return '';
}


/* =========================================================
   SEARCH LRCLIB
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


    const response =
      await fetch(
        url,
        {
          method:
            'GET',

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
        `[LYRIC] LRCLIB HTTP ${response.status}`
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
     * Ưu tiên kết quả có plainLyrics.
     */

    const plainResult =
      data.find(
        item =>
          typeof item?.plainLyrics === 'string' &&
          item.plainLyrics.trim()
      );


    if (plainResult) {

      return plainResult;
    }


    /*
     * Fallback syncedLyrics.
     */

    const syncedResult =
      data.find(
        item =>
          typeof item?.syncedLyrics === 'string' &&
          item.syncedLyrics.trim()
      );


    if (syncedResult) {

      return syncedResult;
    }


    return null;

  } catch (error) {

    if (
      error?.name === 'AbortError'
    ) {

      logger.warn(
        `[LYRIC] LRCLIB timeout after ${API_TIMEOUT_MS}ms`
      );

    } else {

      logger.error(
        '[LYRIC] LRCLIB request error:',
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
   CLEAN LYRICS
========================================================= */

function cleanLyrics(text) {

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

function cleanSyncedLyrics(text) {

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
    .replace(
      /\n{4,}/g,
      '\n\n\n'
    )
    .trim();
}


/* =========================================================
   CREATE EMBED
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
    footer.length
  ) {

    embed.setFooter({
      text:
        footer.join(
          ' • '
        ),
    });
  }


  return embed;
}


/* =========================================================
   SEND LOADING
========================================================= */

async function sendLoading(
  message,
  query
) {

  try {

    return await message.channel
      .send({
        embeds: [
          new EmbedBuilder()
            .setTitle(
              '🎵 Đang tìm bài hát...'
            )
            .setDescription(
              `Đang tìm **${escapeMarkdown(
                query
              )}**...`
            )
            .setColor(
              0x5865f2
            ),
        ],
      });

  } catch (error) {

    logger.warn(
      '[LYRIC] Không thể gửi loading:',
      error?.message ||
      error
    );

    return null;
  }
}


/* =========================================================
   EDIT OR SEND
========================================================= */

async function editOrSend(
  message,
  loadingMessage,
  embed
) {

  /*
   * Có loading message:
   * sửa message đó.
   */

  if (
    loadingMessage &&
    typeof loadingMessage.edit === 'function'
  ) {

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
        .catch(
          error => {

            logger.warn(
              '[LYRIC] Không thể edit loading:',
              error?.message ||
              error
            );

            return false;
          }
        );


    if (edited) {

      return true;
    }
  }


  /*
   * Nếu không edit được:
   * gửi message mới.
   */

  try {

    await message.channel
      .send({
        embeds: [
          embed,
        ],
      });

    return true;

  } catch (error) {

    logger.warn(
      '[LYRIC] Không thể gửi embed:',
      error?.message ||
      error
    );

    return false;
  }
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


  try {

    return await message.channel
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
      });

  } catch (error) {

    logger.warn(
      '[LYRIC] Không thể gửi embed:',
      error?.message ||
      error
    );

    return null;
  }
}


/* =========================================================
   SPLIT TEXT
========================================================= */

function splitText(
  text,
  maxLength = MAX_LYRICS_LENGTH
) {

  const normalized =
    String(
      text || ''
    ).trim();


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
     * Ưu tiên newline.
     */

    let splitAt =
      remaining.lastIndexOf(
        '\n',
        maxLength
      );


    /*
     * Nếu newline quá gần đầu,
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
     * Nếu không có:
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
