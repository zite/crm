import { toast } from 'sonner';

export async function copyText(text: string, message = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(message);
  } catch {
    const el = document.createElement('textarea');
    el.value = text;
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    el.remove();
    toast.success(message);
  }
}
