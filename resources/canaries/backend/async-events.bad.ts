/**
 * CANARY - backend / async-events
 * Rule: async-events-drain-the-bus-before-asserting
 * Violation: the test reads the handler's rows the instant the use case returns without waiting for the event bus to drain, so the assertion races the handler and leaves its events for the next test.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { container } from "~/server/api/container";
import { AssignClaimUseCase } from "~/server/api/modules/claims/use-cases/assign-claim.use-case";
import { db } from "~/server/db";
import { claimFactory } from "~/tests/factories/claim.factory";
import { clientFactory } from "~/tests/factories/client.factory";
import { userFactory } from "~/tests/factories/user.factory";
import { createMockContext } from "~/tests/utils/create-mock-context";

describe("assign claim", () => {
  let assignClaim: AssignClaimUseCase;
  let claimId: string;
  let specialistId: string;

  beforeAll(async () => {
    const client = await clientFactory.create();
    const claim = await claimFactory.create({ clientId: client.id });
    const specialist = await userFactory.create({ role: "SPECIALIST" });

    claimId = claim.id;
    specialistId = specialist.id;
    assignClaim = container.get(AssignClaimUseCase);
  });

  it("notifies the specialist who receives the claim", async () => {
    await assignClaim.execute({
      ctx: createMockContext({ role: "ADMIN" }),
      input: { claimId, assigneeId: specialistId },
    });

    const notifications = await db.prisma.notification.findMany({
      where: { recipientId: specialistId },
      select: { actionType: true, claimId: true },
    });

    expect(notifications).toEqual([{ actionType: "CLAIM_ASSIGNED", claimId }]);
  });
});
