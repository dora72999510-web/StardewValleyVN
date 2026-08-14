import {
  EmbedBuilder,
  SlashCommandBuilder,
} from 'discord.js';

import { logger } from '../utils/logger.js';

/* =========================================================
   CONFIG
========================================================= */

/*
 * Có thể cấu hình bằng:
 *
 * LYRIC_CHANNEL_ID=123456789012345678
 *
 * Nếu không cấu hình:
 * - !lyric vẫn hoạt động ở mọi kênh.
 *
 * Điều này tránh tình trạng bot luôn báo:
 * "Lyric chưa được cấu hình"
 *
 * Nếu bạn MUỐN bắt buộc chỉ một kênh,
 * hãy đặt LYRIC_CHANNEL_ID trong .env.
 */

const LYRIC_CHANNEL_ID =
  String(
    process.env.LYRIC_CHANNEL_ID || ''
  ).trim();


/*
 * LRCLIB API
 */

const LYRICS_API_URL =
  'https://lrclib.net/api/search';


/*
 * Timeout API.
 */

const API_TIMEOUT_MS = 10000;


/*
 * Discord embed description:
 * tối đa 4096 ký tự.
 *
 * Dùng 3800 để chừa khoảng an toàn.
 */

const MAX_LYRICS_LENGTH = 3800;


/*
 * Không gửi quá nhiều message.
 */

const MAX_LYRICS_PAGES = 10;


/* =========================================================
   COMMAND
========================================================= */

const command = {

  /*
   * Prefix command:
   *
   * !lyric Shape of You
   */

  name: 'lyric',

  category: 'music',

  description:
    'Tìm lời bài hát',

  /*
   * Cho messageAdapter biết đây là
   * prefix command hợp lệ.
   */

  prefix: true,

  /*
   * Slash command data.
   */

  data:
    new SlashCommandBuilder()
      .setName('lyric')
      .setDescription(
        'Tìm lời bài hát'
      )
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
     EXECUTE
  ======================================================= */

  async execute(
    message,
    args,
    client
  ) {

    try {

      /*
       * ---------------------------------------------------
       * VALIDATE
       * ---------------------------------------------------
       */

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


      /*
       * ---------------------------------------------------
       * CHANNEL
       * ---------------------------------------------------
       *
       * Nếu có LYRIC_CHANNEL_ID:
       * chỉ cho phép tại channel đó.
       *
       * Nếu không có:
       * cho phép mọi channel.
       */

      if (
        LYRIC_CHANNEL_ID &&
        message.channel.id !==
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


      /*
       * ---------------------------------------------------
       * QUERY
       * ---------------------------------------------------
       */

      const query =
        normalizeLyricsQuery(
          args
        );


      logger.info(
        `[LYRIC] Query: "${query}"`
      );


      /*
       * ---------------------------------------------------
       * EMPTY QUERY
       * ---------------------------------------------------
       */

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
                '',
                'Nên nhập cả **tên ca sĩ + tên bài hát** để có kết quả chính xác hơn.',
              ].join('\n'),

            color:
              0x5865f2,
          }
        );

        return;
      }


      /*
       * ---------------------------------------------------
       * LOADING
       * ---------------------------------------------------
       */

      const loadingMessage =
        await message.channel
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
          })
          .catch(
            error => {

              logger.warn(
                '[LYRIC] Không thể gửi loading:',
                error?.message ||
                  error
              );

              return null;
            }
          );


      /*
       * ---------------------------------------------------
       * SEARCH
       * ---------------------------------------------------
       */

      const result =
        await searchLyrics(
          query
        );


      /*
       * ---------------------------------------------------
       * NOT FOUND
       * ---------------------------------------------------
       */

      if (!result) {

        const embed =
          new EmbedBuilder()
            .setTitle(
              '❌ Không tìm thấy bài hát'
            )
            .setDescription(
              [
                `Không tìm thấy lyrics cho **${escapeMarkdown(
                  query
                )}**.`,
                '',
                'Bạn có thể thử nhập cả **tên ca sĩ + tên bài hát**.',
                '',
                '**Ví dụ:**',
                '`!lyric Ed Sheeran Shape of You`',
                '`!lyric Adele Hello`',
              ].join('\n')
            )
            .setColor(
              0xed4245
            );


        await updateOrSend(
          message,
          loadingMessage,
          embed
        );

        return;
      }


      /*
       * ---------------------------------------------------
       * GET LYRICS
       * ---------------------------------------------------
       */

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
                'Nhưng API không trả về phần lời bài hát.',
                '',
                'Bạn có thể thử nhập lại:',
                '`!lyric Tên ca sĩ Tên bài hát`',
              ].join('\n')
            )
            .setColor(
              0xed4245
            );


        await updateOrSend(
          message,
          loadingMessage,
          embed
        );

        return;
      }


      /*
       * ---------------------------------------------------
       * SPLIT
       * ---------------------------------------------------
       */

      let chunks =
        splitText(
          lyrics,
          MAX_LYRICS_LENGTH
        );


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


      /*
       * ---------------------------------------------------
       * FIRST PAGE
       * ---------------------------------------------------
       */

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
          .catch(
            async error => {

              logger.warn(
                '[LYRIC] Không thể edit loading:',
                error?.message ||
                  error
              );

              await message.channel
                .send({
                  embeds: [
                    firstEmbed,
                  ],
                })
                .catch(
                  () => {}
                );
            }
          );

      } else {

        await message.channel
          .send({
            embeds: [
              firstEmbed,
            ],
          })
          .catch(
            error => {

              logger.warn(
                '[LYRIC] Không thể gửi lyrics:',
                error?.message ||
                  error
              );
            }
          );
      }


      /*
       * ---------------------------------------------------
       * OTHER PAGES
       * ---------------------------------------------------
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
          .catch(
            error => {

              logger.warn(
                `[LYRIC] Không thể gửi page ${
                  index + 1
                }:`,
                error?.message ||
                  error
              );
            }
          );
      }


      logger.info(
        `[LYRIC] Successfully returned "${result.trackName || query}"`
      );

    } catch (error) {

      logger.error(
        '[LYRIC] Command error:',
        error
      );


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

    }

  },

};


/* =========================================================
   SEARCH LRCLIB
========================================================= */

async function searchLyrics(
  query
) {

  if (
    typeof query !==
      'string' ||
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

    const plain =
      data.find(
        item =>
          typeof item?.plainLyrics ===
            'string' &&
          item.plainLyrics.trim()
      );


    if (plain) {

      return plain;
    }


    /*
     * Fallback syncedLyrics.
     */

    const synced =
      data.find(
        item =>
          typeof item?.syncedLyrics ===
            'string' &&
          item.syncedLyrics.trim()
      );


    if (synced) {

      return synced;
    }


    return data[0] || null;

  } catch (error) {

    if (
      error?.name ===
      'AbortError'
    ) {

      logger.warn(
        `[LYRIC] LRCLIB timeout after ${API_TIMEOUT_MS}ms`
      );

    } else {

      logger.error(
        '[LYRIC] LRCLIB error:',
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

function getLyricsText(
  result
) {

  if (!result) {

    return '';
  }


  /*
   * Plain lyrics.
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
   * Synced lyrics.
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
    .replace(
      /\n{4,}/g,
      '\n\n\n'
    )
    .trim();

}


/* =========================================================
   NORMALIZE QUERY
========================================================= */

function normalizeLyricsQuery(
  args
) {

  /*
   * -------------------------------------------------------
   * EMPTY
   * -------------------------------------------------------
   */

  if (
    args === undefined ||
    args === null
  ) {

    return '';
  }


  /*
   * -------------------------------------------------------
   * STRING
   * -------------------------------------------------------
   */

  if (
    typeof args ===
    'string'
  ) {

    return args.trim();
  }


  /*
   * -------------------------------------------------------
   * ARRAY
   * -------------------------------------------------------
   *
   * Ví dụ:
   *
   * [
   *   'Ed',
   *   'Sheeran',
   *   'Shape',
   *   'of',
   *   'You'
   * ]
   */

  if (
    Array.isArray(args)
  ) {

    return args
      .flatMap(
        value =>
          normalizeSingleArgument(
            value
          )
      )
      .filter(Boolean)
      .join(' ')
      .trim();
  }


  /*
   * -------------------------------------------------------
   * OBJECT
   * -------------------------------------------------------
   *
   * Hỗ trợ các adapter truyền:
   *
   * {
   *   query: '...'
   * }
   *
   * {
   *   args: [...]
   * }
   */

  if (
    typeof args ===
    'object'
  ) {

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
      'rawArgs',
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

        const result =
          value
            .flatMap(
              item =>
                normalizeSingleArgument(
                  item
                )
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
     * Nested args.
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
        value === args
      ) {

        continue;
      }


      const result =
        normalizeLyricsQuery(
          value
        );


      if (result) {

        return result;
      }
    }


    /*
     * Tuyệt đối không:
     *
     * String(args)
     *
     * vì sẽ thành:
     *
     * [object Object]
     */

    return '';
  }


  /*
   * Primitive.
   */

  return String(
    args
  ).trim();

}


/* =========================================================
   NORMALIZE ONE ARGUMENT
========================================================= */

function normalizeSingleArgument(
  value
) {

  if (
    value === undefined ||
    value === null
  ) {

    return [];
  }


  if (
    typeof value ===
    'string'
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
    typeof value ===
    'object'
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
      const key
      of keys
    ) {

      if (
        typeof value[key] ===
          'string' &&
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
   UPDATE OR SEND
========================================================= */

async function updateOrSend(
  message,
  loadingMessage,
  embed
) {

  if (
    loadingMessage
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
              '[LYRIC] Edit message failed:',
              error?.message ||
                error
            );

            return false;
          }
        );


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
    .catch(
      error => {

        logger.warn(
          '[LYRIC] Send embed failed:',
          error?.message ||
            error
        );
      }
    );

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
    .catch(
      error => {

        logger.warn(
          '[LYRIC] Không thể gửi embed:',
          error?.message ||
            error
        );

        return null;
      }
    );

}


/* =========================================================
   SPLIT TEXT
========================================================= */

function splitText(
  text,
  maxLength = 3800
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
     * Nếu vẫn không có:
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
