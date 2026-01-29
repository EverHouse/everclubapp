export {
  findMatchingUser,
  upsertVisitor,
  linkPurchaseToUser,
  normalizePhone,
  type MatchCriteria,
  type VisitorData,
} from "./matchingService";

export {
  updateVisitorType,
  updateVisitorTypeByUserId,
  type VisitorType,
  type ActivitySource,
} from "./typeService";

export {
  parseBookingNotes,
  matchBookingToPurchase,
  autoMatchSingleBooking,
  autoMatchAllUnmatchedBookings,
  isAfterClosingHours,
  type BookingTypeInfo,
  type ParsedBookingNotes,
  type PurchaseMatch,
  type AutoMatchResult,
} from "./autoMatchService";
