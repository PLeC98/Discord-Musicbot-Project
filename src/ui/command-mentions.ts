// 등록된 슬래시 명령의 id(이름 → id). 화면이 누르면 입력창에 채워지는 명령 멘션(</이름:id>)을 만든다.
// 등록(app/command-loader 의 deployCommands)이 채운다. 모르는 명령은 `/이름` 글자로 적는다

const ids = new Map<string, string>();
// 한 서버에만 등록했으면(GUILD_ID) 그 서버. 다른 서버의 화면에서는 그 id 가 그 서버의 명령이 아니라 쓰지 않는다
let scopeGuildId: string | null = null;

/** 등록한 명령 목록으로 표를 바꾼다(켜고 끈 명령이 빠지고 들어온다). guildId 는 등록한 서버(전역이면 null) */
function rememberCommandIds(commands: ReadonlyArray<{ name: string; id?: string | null }>, guildId: string | null = null) {
  ids.clear();
  scopeGuildId = guildId;
  for (const { name, id } of commands) if (id) ids.set(name, id);
}

/** 명령 멘션. guildId 는 화면을 보이는 서버. id 를 모르거나 그 서버에 등록한 명령이 아니면 코드 글씨의 `/이름` */
function commandMention(name: string, guildId?: string | null) {
  const id = ids.get(name);
  return id && (scopeGuildId === null || scopeGuildId === guildId) ? `</${name}:${id}>` : `\`/${name}\``;
}

export { rememberCommandIds, commandMention };
