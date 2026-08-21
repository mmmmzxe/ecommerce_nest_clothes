import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { UserRepository } from '../DB/models/User/user.repository';
import { hash } from '../common/security/password.security';

const sellers = [
  { name: 'Fatma', email: 'fatma@extrachic.com', password: 'Password123!', phone: '01000000001', address: 'Cairo' },
  { name: 'Mariam', email: 'mariam@extrachic.com', password: 'Password123!', phone: '01000000002', address: 'Cairo' },
  { name: 'Zeinab', email: 'zeinab@extrachic.com', password: 'Password123!', phone: '01000000003', address: 'Cairo' },
  { name: 'Sara', email: 'sara@extrachic.com', password: 'Password123!', phone: '01000000004', address: 'Cairo' },
];

async function bootstrap() {
  console.log('Initializing NestJS application context for seller seeding...');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const userRepository = app.get(UserRepository);

  for (const seller of sellers) {
    try {
      const existing = await userRepository.findByEmail(seller.email);
      const hashedPassword = hash(seller.password);

      if (existing) {
        await userRepository.updateOne(
          { email: seller.email },
          {
            $set: {
              name: seller.name,
              password: hashedPassword,
              role: 'admin',
              phone: seller.phone,
              address: seller.address,
            },
          }
        );
        console.log(`Updated seller account: ${seller.name} (${seller.email})`);
      } else {
        await userRepository.create({
          name: seller.name,
          email: seller.email,
          password: hashedPassword,
          role: 'admin',
          phone: seller.phone,
          address: seller.address,
        } as any);
        console.log(`Created seller account: ${seller.name} (${seller.email})`);
      }
    } catch (err: any) {
      console.error(`Error processing seller ${seller.name}:`, err.message || err);
    }
  }

  console.log('\n--- SELLER ACCOUNTS READY ---');
  sellers.forEach((s) => {
    console.log(`Name: ${s.name} | Email: ${s.email} | Password: ${s.password} | Role: admin`);
  });

  await app.close();
}

bootstrap().catch((err) => {
  console.error('Fatal error during seller seeding:', err);
  process.exit(1);
});
