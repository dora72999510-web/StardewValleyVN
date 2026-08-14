import {
  EmbedBuilder,
  SlashCommandBuilder,
} from 'discord.js';

import { logger } from '../utils/logger.js';

/* =========================================================
   CONFIG
========================================================= */

/*
 * Kênh sử dụng !lyric
 *
 * .env:
 *
 * LYRIC_CHANNEL_ID=123456789012345678
 *
 * Nếu để trống:
 *
 * LYRIC_CHANNEL_ID=
 *
 * thì !lyric được phép dùng ở mọi kênh.
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
 * API timeout.
 */

const API_TIMEOUT_MS = 10000;


/*
 * Discord Embed description tối đa 4096 ký tự.
 *
 * Dùng 3800 để có khoảng an toàn.
 */

const MAX_LYRICS_LENGTH = 3800;


/*
 * Không gửi quá nhiều trang.
 */

const MAX_LYRICS_PAGES = 10;


/* =========================================================
   COMMAND
========================================================= */

const command = {

  /*
   * Tên command.
   *
   * Prefix:
   *
   * !lyric Shape of You
   *
   * Slash:
   *
   * /lyric
   */

  name: 'lyric',

  category: 'music',

  description:
    'Tìm lời bài hát',


  /*
   * Cho phép messageAdapter chạy
   * command bằng prefix.
   */

  prefix: true,


  /*
   * Slash command.
   *
   * messageAdapter.js của bạn lấy:
   *
   * interaction.options.getString('song')
   *
   * nên option bắt buộc phải tên là "song".
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
     -------------------------------------------------------
     QUAN TRỌNG:
     -------------------------------------------------------
     messageAdapter.js hiện tại gọi:

       command.execute(
         mockInteraction,
         guildConfig,
         client
       );

     Vì vậy KHÔNG dùng:

       execute(message, args, client)

     mà phải dùng:

       execute(interaction, guildConfig, client)
  ======================================================= */

  async execute(
    interaction,
    guildConfig,
    client
  ) {

    try {

      /* =====================================================
         VALIDATE INTERACTION
      ===================================================== */

      if (!interaction) {

        logger.warn(
          '[LYRIC] Interaction không tồn tại.'
        );

        return;
      }


      if (!interaction.channel) {

        logger.warn(
          '[LYRIC] Interaction không có channel.'
        );

        return;
      }


      /* =====================================================
         CHANNEL RESTRICTION
      ===================================================== */

      /*
       * Nếu đã cấu hình LYRIC_CHANNEL_ID:
       *
       * !lyric chỉ được chạy trong channel đó.
       *
       * Nếu không cấu hình:
       *
       * cho phép mọi channel.
       */

      if (
        LYRIC_CHANNEL_ID &&
        interaction.channel.id !==
          LYRIC_CHANNEL_ID
      ) {

        await sendEmbed(
          interaction,
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
         GET SONG QUERY
      ===================================================== */

      /*
       * messageAdapter.js tạo:
       *
       * interaction.options.getString('song')
       *
       * Ví dụ:
       *
       * !lyric Ed Sheeran Shape of You
       *
       * sẽ trở thành:
       *
       * interaction.options.getString('song')
       *
       * = "Ed Sheeran Shape of You"
       */

      const query =
        getSongQuery(
          interaction
        );


      logger.info(
        `[LYRIC] Query: "${query}"`
      );


      /* =====================================================
         EMPTY QUERY
      ===================================================== */

      if (!query) {

        await sendEmbed(
          interaction,
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
                'Bạn nên nhập cả **tên ca sĩ + tên bài hát** để có kết quả chính xác hơn.',
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
        await sendLoadingMessage(
          interaction,
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
          interaction,
          loadingMessage,
          embed
        );

        return;
      }


      /* =====================================================
         EXTRACT LYRICS
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
                'Nhưng API không trả về phần lời bài hát.',
                '',
                'Bạn có thể thử nhập lại với cả tên ca sĩ:',
                '`!lyric Tên ca sĩ Tên bài hát`',
              ].join('\n')
            )
            .setColor(
              0xed4245
            );


        await updateOrSend(
          interaction,
          loadingMessage,
          embed
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


      if (!chunks.length) {

        const embed =
          new EmbedBuilder()
            .setTitle(
              '❌ Lyrics rỗng'
            )
            .setDescription(
              'API trả về dữ liệu nhưng không có nội dung lyrics để hiển thị.'
            )
            .setColor(
              0xed4245
            );


        await updateOrSend(
          interaction,
          loadingMessage,
          embed
        );

        return;
      }


      /*
       * Giới hạn số trang.
       */

      if (
        chunks.length >
        MAX_LYRICS_PAGES
      ) {

        logger.warn(
          `[LYRIC] Lyrics quá dài: ${chunks.length} pages. Chỉ gửi ${MAX_LYRICS_PAGES} pages.`
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


      await updateOrSend(
        interaction,
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


        await sendFollowup(
          interaction,
          embed
        );
      }


      /* =====================================================
         SUCCESS LOG
      ===================================================== */

      logger.info(
        `[LYRIC] Successfully returned "${result.trackName || query}" for ${getUserLabel(interaction)}`
      );

    } catch (error) {

      logger.error(
        '[LYRIC] Command error:',
        error
      );


      try {

        const embed =
          new EmbedBuilder()
            .setTitle(
              '❌ Lỗi lyrics'
            )
            .setDescription(
              'Đã xảy ra lỗi khi tìm lời bài hát. Vui lòng thử lại sau.'
            )
            .setColor(
              0xed4245
            );


        await updateOrSend(
          interaction,
          null,
          embed
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
   GET SONG QUERY
========================================================= */

function getSongQuery(
  interaction
) {

  try {

    /*
     * Đây là cách chính.
     *
     * messageAdapter.js của bạn
     * đã tạo option "song".
     */

    if (
      interaction?.options &&
      typeof interaction.options.getString ===
        'function'
    ) {

      const value =
        interaction.options.getString(
          'song'
        );


      if (
        typeof value ===
          'string' &&
        value.trim()
      ) {

        return value.trim();
      }
    }


    /*
     * Fallback:
     *
     * Một số trường hợp adapter có thể
     * truyền _hoistedOptions.
     */

    if (
      Array.isArray(
        interaction?.options?._hoistedOptions
      )
    ) {

      const option =
        interaction.options._hoistedOptions.find(
          item =>
            item?.name === 'song'
        );


      if (
        typeof option?.value ===
          'string' &&
        option.value.trim()
      ) {

        return option.value.trim();
      }
    }


    /*
     * Fallback cuối cùng:
     *
     * args nếu adapter cũ còn sử dụng.
     */

    if (
      typeof interaction?.args ===
        'string'
    ) {

      return interaction.args.trim();
    }


    if (
      Array.isArray(
        interaction?.args
      )
    ) {

      return interaction.args
        .map(
          normalizeArgument
        )
        .filter(Boolean)
        .join(' ')
        .trim();
    }


    return '';

  } catch (error) {

    logger.error(
      '[LYRIC] Error getting song query:',
      error
    );

    return '';
  }
}


/* =========================================================
   NORMALIZE ARGUMENT
========================================================= */

function normalizeArgument(
  value
) {

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
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {

    return String(value);
  }


  /*
   * Tuyệt đối không:
   *
   * String(value)
   *
   * nếu value là object.
   *
   * Vì sẽ tạo:
   *
   * [object Object]
   */

  if (
    typeof value ===
      'object'
  ) {

    const possibleKeys = [
      'value',
      'name',
      'text',
      'content',
      'query',
    ];


    for (
      const key
      of possibleKeys
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


  return '';
}


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
     * Ưu tiên:
     *
     * 1. plainLyrics
     * 2. syncedLyrics
     */

    const plainResult =
      data.find(
        item =>
          typeof item?.plainLyrics ===
            'string' &&
          item.plainLyrics.trim()
      );


    if (plainResult) {

      return plainResult;
    }


    const syncedResult =
      data.find(
        item =>
          typeof item?.syncedLyrics ===
            'string' &&
          item.syncedLyrics.trim()
      );


    if (syncedResult) {

      return syncedResult;
    }


    return null;

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
   CLEAN PLAIN LYRICS
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
          /*
           * [00:12.34]
           * [01:02.123]
           */

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

async function sendLoadingMessage(
  interaction,
  query
) {

  const embed =
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
      );


  try {

    /*
     * messageAdapter.js tạo interaction
     * có .channel.send().
     */

    if (
      interaction.channel &&
      typeof interaction.channel.send ===
        'function'
    ) {

      return await interaction.channel
        .send({
          embeds: [
            embed,
          ],
        });
    }


    /*
     * Fallback cho Discord Interaction thật.
     */

    if (
      typeof interaction.reply ===
        'function'
    ) {

      await interaction.reply({
        embeds: [
          embed,
        ],
      });


      if (
        typeof interaction.fetchReply ===
          'function'
      ) {

        return await interaction.fetchReply();
      }

      return null;
    }


    return null;

  } catch (error) {

    logger.warn(
      '[LYRIC] Không thể gửi loading message:',
      error?.message ||
        error
    );

    return null;
  }
}


/* =========================================================
   UPDATE OR SEND
========================================================= */

async function updateOrSend(
  interaction,
  loadingMessage,
  embed
) {

  /*
   * Nếu có loading message:
   * edit nó.
   */

  if (
    loadingMessage &&
    typeof loadingMessage.edit ===
      'function'
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
   * Fallback:
   * gửi message mới.
   */

  return await sendEmbed(
    interaction,
    {
      title:
        embed.data?.title ||
        '🎵 Lyric',

      description:
        embed.data?.description ||
        '',

      color:
        embed.data?.color ||
        0x5865f2,
    }
  );
}


/* =========================================================
   SEND FOLLOWUP
========================================================= */

async function sendFollowup(
  interaction,
  embed
) {

  try {

    /*
     * Prefix mock interaction:
     *
     * interaction.channel.send()
     */

    if (
      interaction.channel &&
      typeof interaction.channel.send ===
        'function'
    ) {

      await interaction.channel.send({
        embeds: [
          embed,
        ],
      });

      return true;
    }


    /*
     * Discord Interaction thật:
     *
     * interaction.followUp()
     */

    if (
      typeof interaction.followUp ===
        'function'
    ) {

      await interaction.followUp({
        embeds: [
          embed,
        ],
      });

      return true;
    }


    return false;

  } catch (error) {

    logger.warn(
      '[LYRIC] Không thể gửi lyrics page:',
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
  interaction,
  {
    title,
    description,
    color = 0x5865f2,
  }
) {

  if (!interaction) {

    return null;
  }


  const embed =
    new EmbedBuilder()
      .setTitle(
        title
      )
      .setDescription(
        description
      )
      .setColor(
        color
      );


  try {

    /*
     * Prefix mock interaction.
     */

    if (
      interaction.channel &&
      typeof interaction.channel.send ===
        'function'
    ) {

      return await interaction.channel
        .send({
          embeds: [
            embed,
          ],
        });
    }


    /*
     * Slash interaction.
     */

    if (
      typeof interaction.reply ===
        'function'
    ) {

      return await interaction.reply({
        embeds: [
          embed,
        ],
        ephemeral: true,
      });
    }


    return null;

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
     * Ưu tiên cắt tại newline.
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
     * Không có vị trí phù hợp:
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
   USER LABEL
========================================================= */

function getUserLabel(
  interaction
) {

  try {

    if (
      interaction.user?.tag
    ) {

      return interaction.user.tag;
    }


    if (
      interaction.user?.username
    ) {

      return interaction.user.username;
    }


    if (
      interaction.member?.user?.tag
    ) {

      return interaction.member.user.tag;
    }


    return 'Unknown User';

  } catch {

    return 'Unknown User';
  }
}


/* =========================================================
   EXPORT
========================================================= */

export default command;
