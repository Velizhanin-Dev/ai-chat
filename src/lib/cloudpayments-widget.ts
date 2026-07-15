// Клиентская обёртка над виджетом CloudPayments (оплата зарубежной картой). Скрипт
// грузим лениво один раз при первом использовании (без CSP-ограничений в приложении).

// Минимальный тип виджета — то, что реально используем.
interface CloudPaymentsWidget {
  pay(
    type: "charge" | "auth",
    data: Record<string, unknown>,
    callbacks: {
      onSuccess?: (options: unknown) => void;
      onFail?: (reason: string, options: unknown) => void;
      onComplete?: (paymentResult: unknown, options: unknown) => void;
    }
  ): void;
}
interface CloudPaymentsGlobal {
  CloudPayments: new () => CloudPaymentsWidget;
}

const WIDGET_SRC = "https://widget.cloudpayments.ru/bundles/cloudpayments.js";
let loadPromise: Promise<CloudPaymentsGlobal> | null = null;

function getGlobal(): CloudPaymentsGlobal | null {
  return (window as unknown as { cp?: CloudPaymentsGlobal }).cp ?? null;
}

// Загружает скрипт виджета (идемпотентно) и резолвит глобальный объект `cp`.
export function loadCloudPayments(): Promise<CloudPaymentsGlobal> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("no_window"));
  }
  const existing = getGlobal();
  if (existing) return Promise.resolve(existing);
  if (loadPromise) return loadPromise;

  loadPromise = new Promise<CloudPaymentsGlobal>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = WIDGET_SRC;
    script.async = true;
    script.onload = () => {
      const cp = getGlobal();
      if (cp) resolve(cp);
      else reject(new Error("cp_unavailable"));
    };
    script.onerror = () => {
      loadPromise = null; // дать повторить попытку
      reject(new Error("cp_load_failed"));
    };
    document.head.appendChild(script);
  });
  return loadPromise;
}

export interface CloudWidgetParams {
  publicId: string;
  invoiceId: string;
  amount: number;
  currency: string;
  description: string;
  accountId: string;
  email: string;
}

// Открыть виджет оплаты. Резолвится "success" | "fail" | "cancel" по итогу.
export async function openCloudPaymentsWidget(
  params: CloudWidgetParams
): Promise<"success" | "fail" | "cancel"> {
  const cp = await loadCloudPayments();
  const widget = new cp.CloudPayments();
  return new Promise((resolve) => {
    let settled = false;
    const done = (r: "success" | "fail" | "cancel") => {
      if (!settled) {
        settled = true;
        resolve(r);
      }
    };
    widget.pay(
      "charge",
      {
        publicId: params.publicId,
        description: params.description,
        amount: params.amount,
        currency: params.currency,
        invoiceId: params.invoiceId,
        accountId: params.accountId,
        email: params.email,
        skin: "modern",
      },
      {
        onSuccess: () => done("success"),
        onFail: () => done("fail"),
        // onComplete без успеха и без явного fail = пользователь закрыл окно.
        onComplete: () => done("cancel"),
      }
    );
  });
}
