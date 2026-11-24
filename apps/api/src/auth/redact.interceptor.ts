import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { map, Observable } from 'rxjs';
import { AuthedRequest } from './session.guard';

/** Selling-price keys stay visible to every role. */
const SELLING = /^(price|sale_price|discount_price|current_price|selling|regular_price)/i;
const COST = /cost|margin|profit/i;
const MONEY = /(_paisa|Paisa)$/;

function strip(value: unknown, drop: (key: string) => boolean): unknown {
  if (Array.isArray(value)) return value.map((v) => strip(v, drop));
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (drop(k)) continue;
      out[k] = strip(v, drop);
    }
    return out;
  }
  return value;
}

/** Remove cost / margin fields from responses for anyone but the owner. */
export function redactCost(value: unknown): unknown {
  return strip(value, (k) => COST.test(k));
}

/** Remove every money figure except selling prices (purchases, suppliers, stock value). */
export function redactMoney(value: unknown): unknown {
  return strip(value, (k) => COST.test(k) || (MONEY.test(k) && !SELLING.test(k)));
}

@Injectable()
export class CostRedactInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    return next.handle().pipe(
      map((body) => (req.session && req.session.role !== 'owner' ? redactCost(body) : body)),
    );
  }
}

@Injectable()
export class MoneyRedactInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    return next.handle().pipe(
      map((body) => (req.session && req.session.role !== 'owner' ? redactMoney(body) : body)),
    );
  }
}
