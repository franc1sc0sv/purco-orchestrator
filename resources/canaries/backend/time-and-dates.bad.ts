/**
 * CANARY - backend / time-and-dates
 * Rule: time-fixed-clock-no-wall-clock-arithmetic
 * Violation: the input and the expected value are both built from the wall clock at run time, so the assertion means something different every day and breaks across a month boundary.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { container } from "~/server/api/container";
import { ScheduleInstallmentUseCase } from "~/server/api/modules/payment-plans/use-cases/schedule-installment.use-case";
import { claimFactory } from "~/tests/factories/claim.factory";
import { clientFactory } from "~/tests/factories/client.factory";
import { paymentPlanFactory } from "~/tests/factories/payment-plan.factory";
import { createMockContext } from "~/tests/utils/create-mock-context";

describe("schedule installment", () => {
  let scheduleInstallment: ScheduleInstallmentUseCase;
  let paymentPlanId: string;

  beforeAll(async () => {
    const client = await clientFactory.create();
    const claim = await claimFactory.create({ clientId: client.id });
    const plan = await paymentPlanFactory.create({
      claimId: claim.id,
      installmentAmount: 20000,
    });

    paymentPlanId = plan.id;
    scheduleInstallment = container.get(ScheduleInstallmentUseCase);
  });

  it("schedules the next installment thirty days out", async () => {
    const committedOn = new Date();

    const result = await scheduleInstallment.execute({
      ctx: createMockContext({ role: "ADMIN" }),
      input: { paymentPlanId, committedOn },
    });

    const expectedDueDate = new Date();
    expectedDueDate.setDate(expectedDueDate.getDate() + 30);

    expect(result.dueDate.getDate()).toBe(expectedDueDate.getDate());
    expect(result.dueDate.getMonth()).toBe(expectedDueDate.getMonth());
    expect(result.amount).toBe(20000);
  });
});
