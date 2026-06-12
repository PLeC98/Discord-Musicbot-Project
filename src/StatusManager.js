const fs = require('fs');
const path = require('path');
const { ActivityType } = require('discord.js');
const KoreanLunarCalendar = require('korean-lunar-calendar');

const STATUS_FILE = path.join(__dirname, '../config/status.json');

const TYPE_MAP = {
    Playing: ActivityType.Playing,
    Listening: ActivityType.Listening,
    Watching: ActivityType.Watching,
    Competing: ActivityType.Competing,
};

class StatusManager {
    constructor(client) {
        this.client = client;
        this.rotationIndex = 0;
        this.intervalId = null;
    }

    load() {
        try {
            return JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
        } catch {
            return { rotation: [{ text: '🎵 Beatra | /play' }], rotationInterval: 30, scheduled: [] };
        }
    }

    // MM-DD 형식 날짜 범위 (연말 경계 12-28 ~ 01-05 처리 포함)
    isInDateRange(start, end) {
        const now = new Date();
        const cur = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        return start <= end ? cur >= start && cur <= end : cur >= start || cur <= end;
    }

    // 음력 MM-DD 범위 (오늘 양력 → 음력 변환 후 비교)
    isInLunarDateRange(start, end) {
        const now = new Date();
        const cal = new KoreanLunarCalendar();
        cal.setSolarDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
        const lunar = cal.getLunarCalendar();
        const cur = `${String(lunar.month).padStart(2, '0')}-${String(lunar.day).padStart(2, '0')}`;
        return start <= end ? cur >= start && cur <= end : cur >= start || cur <= end;
    }

    // HH:MM 형식 시간 범위 (심야 22:00~06:00 처리 포함)
    isInTimeRange(start, end) {
        const now = new Date();
        const cur = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        return start <= end ? cur >= start && cur <= end : cur >= start || cur <= end;
    }

    getCurrentEntry(config) {
        for (const entry of (config.scheduled ?? [])) {
            let match = true;
            if (entry.dateRange) match = match && this.isInDateRange(entry.dateRange.start, entry.dateRange.end);
            if (entry.lunarDateRange) match = match && this.isInLunarDateRange(entry.lunarDateRange.start, entry.lunarDateRange.end);
            if (entry.timeRange) match = match && this.isInTimeRange(entry.timeRange.start, entry.timeRange.end);
            if (!match) continue;
            if (entry.rotation?.length) return entry.rotation[this.rotationIndex % entry.rotation.length];
            return entry;
        }
        const rotation = config.rotation ?? [];
        if (rotation.length === 0) return null;
        return rotation[this.rotationIndex % rotation.length];
    }

    apply() {
        const config = this.load();
        const entry = this.getCurrentEntry(config);
        if (!entry || !this.client.user) return;
        const type = TYPE_MAP[entry.type] ?? ActivityType.Listening;
        this.client.user.setActivity({ name: entry.text, type });
    }

    start() {
        const config = this.load();
        const intervalSec = Math.max(config.rotationInterval ?? 30, 10);

        this.apply();

        this.intervalId = setInterval(() => {
            this.rotationIndex++;
            this.apply();
        }, intervalSec * 1000);
    }

    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }
}

module.exports = StatusManager;
