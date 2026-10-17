declare module "request" {
  export default function request(
    method: import("voice:tasking/types@0.1.0").Method,
    path: string,
    body: string | undefined,
  ): string;
}
