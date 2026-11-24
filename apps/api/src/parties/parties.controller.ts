import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SessionGuard, AuthedRequest } from '../auth/session.guard';
import { SellerGuard } from '../auth/roles.guard';
import { OwnerGuard } from '../auth/owner.guard';
import { PartiesService } from './parties.service';

@Controller('parties')
export class PartiesController {
  constructor(private readonly parties: PartiesService) {}

  /** List parties with ledger balance (debits − credits). Owner + Cashier. */
  @Get()
  @UseGuards(SessionGuard)
  list(@Req() req: AuthedRequest) {
    // Data entry never sees what customers owe.
    const hide = req.session?.role === 'data_entry';
    const items = this.parties
      .list()
      .map((p) => (hide ? { ...p, balance_paisa: 0, credit_limit_paisa: null, balance_hidden: true } : p));
    return { items, count: items.length };
  }

  /** Owner: set or clear a customer's udhaar limit (Rs; null clears). */
  @Post(':id/credit-limit')
  @HttpCode(200)
  @UseGuards(SessionGuard, OwnerGuard)
  creditLimit(@Param('id') id: string, @Body() body: { limitRs?: number | string | null }) {
    const r = this.parties.setCreditLimit(id, body?.limitRs ?? null);
    if (!r.ok) {
      if (r.error === 'party_not_found') throw new NotFoundException(r);
      throw new BadRequestException(r);
    }
    return r;
  }

  /**
   * Party detail: balance_paisa + ledger history (newest first).
   * Debits from udhaar/split sales; credits from collections (and void reversals).
   * Owner + Cashier.
   */
  @Get(':id')
  @UseGuards(SessionGuard)
  detail(@Req() req: AuthedRequest, @Param('id') id: string) {
    const party = this.parties.get(id);
    if (!party) {
      throw new NotFoundException({ ok: false, error: 'party_not_found' });
    }
    // Data entry edits name / phone / address only: no balance, no khata.
    if (req.session?.role === 'data_entry') {
      return {
        ok: true as const,
        party: { ...party, balance_paisa: 0, credit_limit_paisa: null, balance_hidden: true },
        ledger: [],
      };
    }
    const ledger = this.parties.ledger(id);
    return { ok: true as const, party, ledger };
  }

  /** Create customer (name required; phone + address optional). Used by POS + Customers. */
  @Post()
  @UseGuards(SessionGuard)
  create(
    @Req() req: AuthedRequest,
    @Body()
    body: { name?: string; phone?: string | null; address?: string | null },
  ) {
    const result = this.parties.create({
      name: body.name ?? '',
      phone: body.phone,
      address: body.address,
      storeId: req.session?.storeId,
    });
    if (!result.ok) {
      return { ok: false as const, error: result.error };
    }
    return { ok: true as const, party: result.party };
  }


  /** Update customer name / phone / address. Owner + Cashier. */
  @Patch(':id')
  @UseGuards(SessionGuard)
  update(
    @Param('id') id: string,
    @Body()
    body: { name?: string; phone?: string | null; address?: string | null },
  ) {
    const result = this.parties.update({
      id,
      name: body.name ?? '',
      phone: body.phone,
      address: body.address,
    });
    if (!result.ok) {
      if (result.error === 'party_not_found') {
        throw new NotFoundException({ ok: false, error: result.error });
      }
      return { ok: false as const, error: result.error };
    }
    return { ok: true as const, party: result.party };
  }

  /**
   * Record cash collection (udhaar pay-in) against a party.
   * Append-only party_ledger credit; sale_id null. Balance = debits − credits.
   * Optional collected_on / date (YYYY-MM-DD Asia/Karachi); defaults to today.
   * Refuses amount ≤ 0 (400), invalid date (400), and amount > balance (409).
   * Owner + Cashier.
   */
  @Post(':id/collections')
  @HttpCode(201)
  @UseGuards(SessionGuard, SellerGuard)
  collect(
    @Param('id') id: string,
    @Body()
    body: {
      amount_paisa?: number;
      amountPaisa?: number;
      note?: string | null;
      collected_on?: string | null;
      collectedOn?: string | null;
      date?: string | null;
    },
  ) {
    const amountPaisa =
      body.amount_paisa != null
        ? body.amount_paisa
        : body.amountPaisa != null
          ? body.amountPaisa
          : undefined;

    const collectedOn =
      body.collected_on ?? body.collectedOn ?? body.date ?? null;

    const result = this.parties.recordCollection({
      partyId: id,
      amountPaisa: amountPaisa as number,
      note: body.note,
      collectedOn,
    });

    if (!result.ok) {
      if (result.error === 'party_not_found') {
        throw new NotFoundException({ ok: false, error: result.error });
      }
      if (result.error === 'amount_exceeds_balance') {
        throw new ConflictException({
          ok: false,
          error: 'amount_exceeds_balance',
          balance_paisa: result.balance_paisa ?? 0,
        });
      }
      throw new BadRequestException({ ok: false, error: result.error });
    }

    return {
      ok: true as const,
      entry: result.entry,
      party: result.party,
    };
  }
}
