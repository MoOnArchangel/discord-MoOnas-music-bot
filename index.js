require("dotenv").config();

const { Client, GatewayIntentBits, Partials } = require("discord.js");
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require("@discordjs/voice");
const ytdlp = require("yt-dlp-exec");
const ffmpeg = require("ffmpeg-static");
const { spawn } = require("child_process");
const { pipeline } = require("stream/promises");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// Server queues: { guildId: { player, connection, songs: [] } }
const queues = new Map();

client.once("ready", () => console.log(`Logged in as ${client.user.tag}`));

client.on("messageCreate", async message => {
  if (message.author.bot) return;

  const args = message.content.split(" ");
  const command = args[0].toLowerCase();

  if (command === "!play") {
    const url = args[1];
    if (!url) return message.reply("Provide a YouTube link!");

    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel) return message.reply("Join a voice channel first!");

    let serverQueue = queues.get(message.guild.id);

    if (!serverQueue) {
      // Create new queue for this server
      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: message.guild.id,
        adapterCreator: message.guild.voiceAdapterCreator
      });

      const player = createAudioPlayer();

      serverQueue = {
        player,
        connection,
        songs: []
      };

      queues.set(message.guild.id, serverQueue);

      // Play next song automatically when one finishes
      player.on(AudioPlayerStatus.Idle, () => {
        serverQueue.songs.shift(); // remove finished song
        if (serverQueue.songs.length > 0) {
          playSong(message.guild.id, serverQueue.songs[0]);
        }
      });

      player.on("error", err => {
        console.error("Player error:", err);
        serverQueue.songs.shift(); // skip faulty song
        if (serverQueue.songs.length > 0) playSong(message.guild.id, serverQueue.songs[0]);
      });

      connection.subscribe(player);
    }

    // Add song to queue
    serverQueue.songs.push(url);
    message.reply(`Added to queue 🎵`);

    // If nothing is playing, start the first song
    if (serverQueue.songs.length === 1) {
      playSong(message.guild.id, url);
    }
  }

  if (command === "!skip") {
    const serverQueue = queues.get(message.guild.id);
    if (!serverQueue || serverQueue.songs.length === 0) return message.reply("Nothing to skip!");
    
    serverQueue.player.stop(); // triggers AudioPlayerStatus.Idle → next song plays
    message.reply("Skipped ⏭️");
  }

  if (command === "!stop") {
    const serverQueue = queues.get(message.guild.id);
    if (!serverQueue) return message.reply("Nothing is playing!");

    serverQueue.songs = [];
    serverQueue.player.stop();
    message.reply("Stopped ⏹️");
  }
});

// Helper to play a song URL
async function playSong(guildId, url) {
  const serverQueue = queues.get(guildId);
  if (!serverQueue) return;

  try {
    const stream = ytdlp.exec(url, {
      output: "-",
      format: "bestaudio",
      quiet: true,
      noPlaylist: true
    });

    const ffmpegProcess = spawn(ffmpeg, [
      "-i", "pipe:0",
      "-f", "s16le",
      "-ar", "48000",
      "-ac", "2",
      "pipe:1"
    ]);

    await pipeline(stream.stdout, ffmpegProcess.stdin);

    const resource = createAudioResource(ffmpegProcess.stdout);
    serverQueue.player.play(resource);

  } catch (err) {
    console.error("Audio error:", err);
    serverQueue.songs.shift(); // remove failed song
    if (serverQueue.songs.length > 0) {
      playSong(guildId, serverQueue.songs[0]);
    }
  }
}

client.login(process.env.DISCORD_TOKEN);