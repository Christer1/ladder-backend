import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { App, cert, deleteApp, initializeApp } from 'firebase-admin/app';
import type { Auth } from 'firebase-admin/auth';
import { Firestore, getFirestore } from 'firebase-admin/firestore';
import { EnvironmentVariables, parseServiceAccount } from '../../config/env.validation';

// Firebase Admin for the web help chat: Firestore writes and the customer's chat tokens.
// Created on first use, so the app starts (and tests run) without FIREBASE_SERVICE_ACCOUNT.
@Injectable()
export class FirebaseService {
  private app?: App;

  constructor(private readonly config: ConfigService<EnvironmentVariables, true>) {}

  get isConfigured(): boolean {
    return Boolean(this.config.get('FIREBASE_SERVICE_ACCOUNT', { infer: true }));
  }

  get firestore(): Firestore {
    return getFirestore(this.getApp());
  }

  // Loaded on first use: it pulls in an ES-module-only dependency (jose) that Jest can't parse.
  async auth(): Promise<Auth> {
    const { getAuth } = await import('firebase-admin/auth');
    return getAuth(this.getApp());
  }

  async onModuleDestroy(): Promise<void> {
    if (this.app) await deleteApp(this.app);
  }

  private getApp(): App {
    if (this.app) return this.app;
    // Checked by validateEnv; callers check isConfigured first.
    const account = parseServiceAccount(
      this.config.get('FIREBASE_SERVICE_ACCOUNT', { infer: true }) ?? '',
    );
    if (!account) throw new Error('FIREBASE_SERVICE_ACCOUNT is not set');
    this.app = initializeApp({ credential: cert(account) }, 'ladder');
    return this.app;
  }
}
