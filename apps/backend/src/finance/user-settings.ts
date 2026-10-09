import type { PrismaService } from '../database/prisma.service.js';
import type { AppLocale } from '../generated/prisma/enums.js';

export interface UserSettings {
  currency: string;
  timeZone: string;
  locale: AppLocale;
}

/** Regional settings that drive financial defaults (currency) and "today" (time zone). */
export async function userSettings(
  prisma: PrismaService,
  userId: string,
): Promise<UserSettings> {
  const profile = await prisma.userProfile.findUnique({
    where: { userId },
    select: { currency: true, timeZone: true, locale: true },
  });
  return {
    currency: profile?.currency ?? 'BRL',
    timeZone: profile?.timeZone ?? 'America/Sao_Paulo',
    locale: profile?.locale ?? 'pt_BR',
  };
}
