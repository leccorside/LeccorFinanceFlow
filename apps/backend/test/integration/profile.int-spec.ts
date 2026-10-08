import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import {
  createDisposableDatabase,
  type DisposableDatabase,
} from './disposable-database.js';
import { createTestApp, FakeGoogle, loginAs, type Session, testEnv } from './support.js';

let db: DisposableDatabase;
let app: NestExpressApplication;
let google: FakeGoogle;
let alice: Session;
let bob: Session;

beforeAll(async () => {
  db = await createDisposableDatabase();
  testEnv(db.url);
  google = new FakeGoogle();
  app = await createTestApp(google);
  alice = await loginAs(app, google, {
    subject: 'sub-alice',
    email: 'alice@example.com',
    givenName: 'Alice',
    familyName: 'Souza',
  });
  bob = await loginAs(app, google, {
    subject: 'sub-bob',
    email: 'bob@example.com',
    givenName: 'Bob',
  });
});

afterAll(async () => {
  await app?.close();
  await db?.drop();
});

const http = () => request(app.getHttpServer());
const getProfile = (session: Session) =>
  http().get('/api/v1/profile').set('Cookie', session.cookie);
const patchProfile = (session: Session, body: unknown) =>
  http()
    .patch('/api/v1/profile')
    .set('Cookie', session.cookie)
    .set('X-CSRF-Token', session.csrf)
    .send(body as object);

describe('GET /profile', () => {
  it('returns the defaults and Google name for a new user', async () => {
    const response = await getProfile(alice).expect(200);
    expect(response.body).toMatchObject({
      email: 'alice@example.com',
      firstName: 'Alice',
      lastName: 'Souza',
      phone: null,
      locale: 'pt-BR',
      currency: 'BRL',
      timeZone: 'America/Sao_Paulo',
      preferences: { theme: 'system', weekStartsOn: 'monday' },
      voice: { gender: 'FEMALE', autoSpeak: true, speakingRate: 1 },
    });
  });

  it('requires a session', async () => {
    await http().get('/api/v1/profile').expect(401);
  });

  it('works for a user without a profile row (defaults, then created on first PATCH)', async () => {
    const carol = await loginAs(app, google, {
      subject: 'sub-carol',
      email: 'carol@example.com',
    });
    const carolUser = await db.client.user.findUniqueOrThrow({
      where: { email: 'carol@example.com' },
    });
    await db.client.userProfile.delete({ where: { userId: carolUser.id } });

    await getProfile(carol)
      .expect(200)
      .expect((response) => {
        expect(response.body).toMatchObject({ firstName: null, locale: 'pt-BR' });
      });
    await patchProfile(carol, { locale: 'en-US' }).expect(200);
    expect(await db.client.userProfile.count({ where: { userId: carolUser.id } })).toBe(
      1,
    );
  });
});

describe('PATCH /profile', () => {
  it('persists every editable field and keeps the ones not sent', async () => {
    await patchProfile(alice, {
      firstName: 'Alícia',
      phone: '+5511999998888',
      photoUrl: 'https://cdn.example/alice.png',
      currency: 'EUR',
      timeZone: 'Europe/Madrid',
      locale: 'es-ES',
      preferences: { theme: 'dark' },
      voice: { gender: 'MALE', speakingRate: 1.25 },
    }).expect(200);

    const response = await getProfile(alice).expect(200);
    expect(response.body).toMatchObject({
      firstName: 'Alícia',
      lastName: 'Souza',
      phone: '+5511999998888',
      photoUrl: 'https://cdn.example/alice.png',
      currency: 'EUR',
      timeZone: 'Europe/Madrid',
      locale: 'es-ES',
      preferences: { theme: 'dark', weekStartsOn: 'monday' },
      voice: { gender: 'MALE', autoSpeak: true, speakingRate: 1.25 },
    });
  });

  it.each(['pt-BR', 'en-US', 'es-ES'])('switches the language to %s', async (locale) => {
    const response = await patchProfile(alice, { locale }).expect(200);
    expect((response.body as { locale: string }).locale).toBe(locale);
  });

  it('merges preferences and clears optional fields with null', async () => {
    await patchProfile(alice, {
      preferences: { weekStartsOn: 'sunday' },
      phone: null,
    }).expect(200);
    const response = await getProfile(alice).expect(200);
    expect(response.body).toMatchObject({
      phone: null,
      preferences: { theme: 'dark', weekStartsOn: 'sunday' },
    });
  });

  it('never accepts the e-mail (trusted value) or other identity fields', async () => {
    for (const body of [
      { email: 'evil@example.com' },
      { roles: ['ADMIN'] },
      { userId: 'x' },
    ]) {
      const response = await patchProfile(alice, body).expect(400);
      expect(response.body).toMatchObject({ code: 'validation_failed' });
    }
    const user = await db.client.user.findUniqueOrThrow({
      where: { googleSubject: 'sub-alice' },
    });
    expect(user.email).toBe('alice@example.com');
  });

  it('rejects invalid time zones, currencies and languages', async () => {
    await patchProfile(alice, { timeZone: 'Mars/Base' }).expect(400);
    await patchProfile(alice, { currency: 'XYZ' }).expect(400);
    await patchProfile(alice, { locale: 'fr-FR' }).expect(400);
    await patchProfile(alice, {}).expect(400);
  });

  it('requires the CSRF token', async () => {
    const response = await http()
      .patch('/api/v1/profile')
      .set('Cookie', alice.cookie)
      .send({ firstName: 'Sem token' })
      .expect(403);
    expect(response.body).toMatchObject({ code: 'csrf_failed' });
  });

  it("only ever changes the caller's own profile", async () => {
    const bobBefore = (await getProfile(bob).expect(200)).body as Record<string, unknown>;

    await patchProfile(alice, { firstName: 'Só Alice', timeZone: 'Asia/Tokyo' }).expect(
      200,
    );

    const bobAfter = (await getProfile(bob).expect(200)).body as Record<string, unknown>;
    expect(bobAfter).toEqual(bobBefore);
    // Bob's CSRF token cannot be used with Alice's session.
    await http()
      .patch('/api/v1/profile')
      .set('Cookie', alice.cookie)
      .set('X-CSRF-Token', bob.csrf)
      .send({ firstName: 'Cruzado' })
      .expect(403);
    // There is no route addressing a profile by id.
    const bobUser = await db.client.user.findUniqueOrThrow({
      where: { googleSubject: 'sub-bob' },
    });
    await http()
      .get(`/api/v1/profile/${bobUser.id}`)
      .set('Cookie', alice.cookie)
      .expect(404);
  });
});

describe('e-mail from the verified Google identity', () => {
  it('follows the verified Google e-mail on login', async () => {
    await loginAs(app, google, { subject: 'sub-dora', email: 'dora@example.com' });
    await loginAs(app, google, { subject: 'sub-dora', email: 'Dora.New@Example.com' });

    const user = await db.client.user.findUniqueOrThrow({
      where: { googleSubject: 'sub-dora' },
    });
    expect(user.email).toBe('dora.new@example.com');
  });

  it('keeps the current e-mail when the new one belongs to another account', async () => {
    await loginAs(app, google, { subject: 'sub-eva', email: 'eva@example.com' });
    await loginAs(app, google, { subject: 'sub-eva', email: 'bob@example.com' });

    const eva = await db.client.user.findUniqueOrThrow({
      where: { googleSubject: 'sub-eva' },
    });
    const bobUser = await db.client.user.findUniqueOrThrow({
      where: { googleSubject: 'sub-bob' },
    });
    expect(eva.email).toBe('eva@example.com');
    expect(bobUser.email).toBe('bob@example.com');
  });
});
