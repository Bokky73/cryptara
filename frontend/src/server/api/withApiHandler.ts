import type { NextRequest } from "next/server";
import type { ZodType } from "zod";
import {
  ApiError,
  withApiHandler as withBaseApiHandler,
  type ApiHandler,
  type ApiHandlerConfig,
  type ApiHandlerContext,
} from "./errors";
import { checkRateLimit, rateLimitProfiles } from "@/server/security/rateLimit";
import { withRouteSpan } from "@/server/observability/tracing/spans";

type RateLimitOptions = Parameters<typeof checkRateLimit>[1];

type SchemaPair<TBody, TQuery> = {
  body?: ZodType<TBody>;
  query?: ZodType<TQuery>;
};

type EnrichedContext<TBody, TQuery> = ApiHandlerContext<TBody, TQuery> & {
  data: TBody;
  requestStartedAt: number;
};

type ContextHandler<TBody, TQuery> = (
  ctx: EnrichedContext<TBody, TQuery>,
) => Response | Promise<Response>;

type RequestHandler<TBody, TQuery> = (
  request: NextRequest,
  ctx: EnrichedContext<TBody, TQuery>,
) => Response | Promise<Response>;

export interface RouteApiHandlerConfig<TBody = unknown, TQuery = unknown> {
  schema?: ZodType<TBody> | SchemaPair<TBody, TQuery>;
  querySchema?: ZodType<TQuery>;
  rateLimit?: string | RateLimitOptions;
  maxBodyBytes?: number;
  auth?: true | string | ((request: NextRequest) => unknown | Promise<unknown>);
  bodyMethods?: readonly string[];
  span?: string;
}

function resolveRateLimitOptions(rateLimit: string | RateLimitOptions): RateLimitOptions {
  if (typeof rateLimit !== "string") return rateLimit;
  if (rateLimit === "executePrepare") return rateLimitProfiles.executionPrepare;
  return (
    rateLimitProfiles[rateLimit as keyof typeof rateLimitProfiles] ?? {
      namespace: rateLimit,
      limit: 60,
      windowMs: 60_000,
    }
  );
}

export function withApiHandler<TBody = unknown, TQuery = unknown>(
  config: RouteApiHandlerConfig<TBody, TQuery>,
  handler: ContextHandler<TBody, TQuery>,
): (request: NextRequest, context?: { params?: Record<string, string> }) => Promise<Response>;
export function withApiHandler<TBody = unknown, TQuery = unknown>(
  config: RouteApiHandlerConfig<TBody, TQuery>,
  handler: RequestHandler<TBody, TQuery>,
): (request: NextRequest, context?: { params?: Record<string, string> }) => Promise<Response>;
export function withApiHandler<TBody = unknown, TQuery = unknown>(
  config: RouteApiHandlerConfig<TBody, TQuery>,
  handler: ContextHandler<TBody, TQuery> | RequestHandler<TBody, TQuery>,
): (request: NextRequest, context?: { params?: Record<string, string> }) => Promise<Response> {
  const schemaPair =
    config.schema && "body" in config.schema ? (config.schema as SchemaPair<TBody, TQuery>) : undefined;
  const bodySchema = schemaPair ? schemaPair.body : (config.schema as ZodType<TBody> | undefined);
  const querySchema = schemaPair?.query ?? config.querySchema;
  const rateLimitOptions = config.rateLimit ? resolveRateLimitOptions(config.rateLimit) : undefined;

  const baseConfig: ApiHandlerConfig<TBody, TQuery> = {
    schema: bodySchema as ApiHandlerConfig<TBody, TQuery>["schema"],
    querySchema: querySchema as ApiHandlerConfig<TBody, TQuery>["querySchema"],
    maxBodyBytes: config.maxBodyBytes,
    auth: typeof config.auth === "function" ? config.auth : undefined,
    bodyMethods: config.bodyMethods,
    rateLimit: rateLimitOptions
      ? (request) => {
          const response = checkRateLimit(request, rateLimitOptions);
          if (response) {
            throw new ApiError("rate_limited", "Too many requests.", 429, {
              retryable: true,
              recoveryAction: "retry",
            });
          }
        }
      : undefined,
  };

  return withBaseApiHandler<TBody, TQuery>(baseConfig, (async (context) => {
    const handlerSource = Function.prototype.toString.call(handler);
    const firstParam = handlerSource.match(/^\s*(?:async\s*)?\(?\s*([A-Za-z_$][\w$]*)/)?.[1];
    const expectsRequestDirectly = handler.length === 1 && firstParam === "request";
    const enrichedContext: EnrichedContext<TBody, TQuery> = {
      ...context,
      data: context.body,
      requestStartedAt: performance.now(),
    };
    const invoke = async (): Promise<Response> => {
      if (expectsRequestDirectly) {
        return (handler as unknown as (request: NextRequest) => Response | Promise<Response>)(context.request);
      }
      if (handler.length >= 2) {
        return (
          handler as unknown as (
            request: NextRequest,
            ctx: EnrichedContext<TBody, TQuery>,
          ) => Response | Promise<Response>
        )(context.request, enrichedContext);
      }
      return (handler as (ctx: EnrichedContext<TBody, TQuery>) => Response | Promise<Response>)(enrichedContext);
    };

    if (!config.span) return invoke();
    return withRouteSpan(
      config.span,
      { "http.method": context.request.method, "http.route": config.span },
      invoke,
    );
  }) as ApiHandler<TBody, TQuery>);
}
