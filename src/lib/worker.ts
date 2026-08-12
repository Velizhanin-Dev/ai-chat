import {
  claimJob,
  completeJob,
  failJob,
  getJobHandler,
  isFatalJobError,
} from "@/lib/jobs-server";
import { isJobKind } from "@/lib/jobs";
import "@/lib/job-handlers"; // регистрация обработчиков (побочный эффект импорта)

// Воркер очереди. Живёт В ТОМ ЖЕ процессе, что и приложение — у нас один инстанс,
// отдельный контейнер тут ничего не добавил бы, кроме ещё одной вещи, которую надо
// деплоить и мониторить. Когда инстансов станет несколько, воркер выносится в свой
// процесс: он уже самодостаточен (claimJob атомарен, см. jobs-server.ts).
//
// ⚠️ Запускается ЛЕНИВО из node-роутов (ensureWorker в jobs-server.ts), а НЕ из
// instrumentation.ts. Причина: Next компилирует instrumentation и под edge-рантайм
// (там же живёт middleware), и хотя запуск закрыт проверкой NEXT_RUNTIME, сборщик
// всё равно трассирует импорт и падает на node-модулях обработчиков
// («Module not found: Can't resolve 'fs' / 'crypto'»), роняя страницы в 500.
// Роуты — гарантированно node, там этой проблемы нет.

// Пауза между опросами пустой очереди. 1.5с — компромисс: задержка старта
// незаметна на фоне самих задач (десятки секунд), а Postgres не насилуем.
const IDLE_MS = 1500;
// Сколько задач крутим одновременно. Все они упираются во внешние API
// (OpenRouter, YouTube), а не в CPU, поэтому больше одной — нормально; но и не
// десятки, иначе упрёмся в rate limit провайдера.
const CONCURRENCY = 2;

const workerId = `w-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

let started = false;
let running = 0;

async function runOne(): Promise<boolean> {
  const job = await claimJob(workerId);
  if (!job) return false;

  const t0 = Date.now();
  try {
    if (!isJobKind(job.kind)) throw new Error(`Неизвестный тип задачи: ${job.kind}`);
    const handler = getJobHandler(job.kind);
    if (!handler) throw new Error(`Нет обработчика для ${job.kind}`);

    const result = await handler({
      jobId: job.id,
      userId: job.userId,
      conversationId: job.conversationId,
      payload: (job.payload ?? {}) as Record<string, unknown>,
    });
    await completeJob(job.id, result);
    console.log(`[worker] ${job.kind} ${job.id} done in ${Date.now() - t0}ms`);
  } catch (err) {
    // Текст ошибки увидит пользователь — поэтому человеческий, без стеков.
    const msg = err instanceof Error ? err.message : "Не удалось выполнить задачу";
    console.error(`[worker] ${job.kind} ${job.id} failed (попытка ${job.attempts}):`, err);
    await failJob(job.id, job.attempts, msg, isFatalJobError(err)).catch((e) =>
      console.error("[worker] не смог записать ошибку задачи:", e)
    );
  }
  return true;
}

async function loop(): Promise<void> {
  for (;;) {
    try {
      if (running >= CONCURRENCY) {
        await sleep(200);
        continue;
      }
      running += 1;
      const took = await runOne().finally(() => {
        running -= 1;
      });
      // Очередь пуста — подождать; была работа — сразу за следующей.
      if (!took) await sleep(IDLE_MS);
    } catch (err) {
      // Сюда попадают только сбои самой очереди (БД недоступна). Ошибки задач
      // ловятся внутри runOne. Падать нельзя — воркер должен пережить и это.
      console.error("[worker] сбой цикла очереди:", err);
      await sleep(5000);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Запуск. Идемпотентен: в dev Next перезагружает модули, и без флага воркеров
// расплодилось бы по числу горячих перезагрузок.
export function startWorker(): void {
  if (started) return;
  started = true;
  console.log(`[worker] запущен (${workerId}), параллельно ${CONCURRENCY}`);
  void loop();
}
