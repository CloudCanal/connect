export interface ApiOptions extends Omit<RequestInit, 'method' | 'body'> {
  body?: unknown;
  timeout?: number;
}

export interface ApiResponse<T = unknown> {
  data: T;
  status: number;
  ok: boolean;
}

export const actions = {
  /**
   * Make an API request
   */
  async api<T = unknown>(
    url: string,
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' = 'GET',
    options: ApiOptions = {}
  ): Promise<ApiResponse<T>> {
    const { body, timeout = 30000, headers = {}, ...restOptions } = options;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const fetchOptions: RequestInit = {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers
        },
        signal: controller.signal,
        ...restOptions
      };

      if (body !== undefined && method !== 'GET') {
        fetchOptions.body = JSON.stringify(body);
      }

      const response = await fetch(url, fetchOptions);
      clearTimeout(timeoutId);

      let data: T;
      const contentType = response.headers.get('content-type');

      if (contentType?.includes('application/json')) {
        data = await response.json();
      } else {
        data = await response.text() as unknown as T;
      }

      return {
        data,
        status: response.status,
        ok: response.ok
      };
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Request timeout after ${timeout}ms`);
      }
      throw error;
    }
  },

  /**
   * Focus an element by selector
   */
  focus(selector: string): boolean {
    const el = document.querySelector<HTMLElement>(selector);
    if (el) {
      el.focus();
      return true;
    }
    return false;
  },

  /**
   * Scroll an element into view
   */
  scroll(selector: string, options?: ScrollIntoViewOptions): boolean {
    const el = document.querySelector(selector);
    if (el) {
      el.scrollIntoView(options ?? { behavior: 'smooth' });
      return true;
    }
    return false;
  },

  /**
   * Delay execution for a specified time
   */
  delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  },

  /**
   * Copy text to clipboard
   */
  async copyToClipboard(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();

      try {
        document.execCommand('copy');
        return true;
      } catch {
        return false;
      } finally {
        document.body.removeChild(textarea);
      }
    }
  },

  /**
   * Read from clipboard
   */
  async readClipboard(): Promise<string | null> {
    try {
      return await navigator.clipboard.readText();
    } catch {
      return null;
    }
  },

  /**
   * Dispatch a custom DOM event on an element
   */
  dispatchEvent(selector: string, eventName: string, detail?: unknown): boolean {
    const el = document.querySelector(selector);
    if (el) {
      el.dispatchEvent(new CustomEvent(eventName, {
        detail,
        bubbles: true,
        composed: true
      }));
      return true;
    }
    return false;
  }
};
