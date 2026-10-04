// 설정 파일 편집기 하나의 주고받기: 읽기 · 저장 · 되돌리기 · 저장하지 않은 편집 · 서버가 짚은 문제.
// 장르 · 상태 문구 · AI 설정 편집기가 같이 쓴다. 화면에 그릴 모양으로 바꾸는 것(apply)과 보낼 모양(payload)은 편집기가 정한다

import { ref, computed, watch } from "vue";
import axios from "axios";
import { trackUnsaved } from "./unsaved.ts";
import { problemDetails, problemText } from "../utils/problem.ts";
import type { ConfigFile, ConfigSaved } from "../../../src/dashboard/contract/admin.ts";

type Data = Record<string, unknown>;

type Options = {
  /** 저장하지 않은 편집을 알릴 이름(운영자 화면의 탭) */
  tab: string;
  /** 설정 말고도 저장하지 않은 것이 있는지(적어 두고 저장하지 않은 키 등) */
  alsoUnsaved?: () => boolean;
  /** 보낼 모양. 바뀌었는지는 마지막으로 받은 것과 견준다 */
  payload: () => unknown;
  /** 받은 것을 편집기에 넣는다 */
  apply: (data: Data) => void;
  /** 읽기. 기본은 GET /api/admin/config/<name> */
  read: () => Promise<Data>;
  /** 저장하고 저장된 것을 돌려받는다 */
  write: (payload: unknown) => Promise<Data>;
};

/** /api/admin/config/<name> 으로 읽고 쓰는 것 */
export const configFileIo = (name: string) => ({
  read: async () => (await axios.get<ConfigFile>(`/api/admin/config/${name}`)).data.data,
  write: async (payload: unknown) => (await axios.put<ConfigSaved>(`/api/admin/config/${name}`, { data: payload })).data.data,
});

export function useConfigFile({ tab, alsoUnsaved, payload, apply, read, write }: Options) {
  const snapshot = ref("");
  const saving = ref(false);
  const savedAt = ref<number | null>(null);
  const loadError = ref("");
  const serverProblems = ref<string[]>([]);

  const dirty = computed(() => JSON.stringify(payload()) !== snapshot.value);
  trackUnsaved(
    tab,
    computed(() => dirty.value || Boolean(alsoUnsaved?.())),
  );

  // 고치면 지난 저장 완료 · 서버 문제를 걷는다. 저장한 값을 다시 넣는 것도 payload 를 바꾸므로 저장한 값과 다를 때만
  watch(payload, () => {
    if (!dirty.value) return;
    savedAt.value = null;
    serverProblems.value = [];
  });

  /** 받은 것을 넣고 이것을 기준(저장된 상태)으로 삼는다 */
  function load(data: Data) {
    apply(data);
    snapshot.value = JSON.stringify(payload());
  }

  async function fetch() {
    loadError.value = "";
    try {
      load(await read());
    } catch (error) {
      loadError.value = problemText(error, "설정을 읽지 못했습니다.");
    }
  }

  async function save() {
    saving.value = true;
    serverProblems.value = [];
    try {
      load(await write(payload()));
      savedAt.value = Date.now();
    } catch (error) {
      const details = problemDetails(error);
      serverProblems.value = details.length ? details : [problemText(error, "저장하지 못했습니다.")];
    } finally {
      saving.value = false;
    }
  }

  /** 마지막으로 받은 것으로 되돌린다 */
  const revert = () => load(JSON.parse(snapshot.value) as Data);

  return { dirty, saving, savedAt, loadError, serverProblems, load, fetch, save, revert };
}
