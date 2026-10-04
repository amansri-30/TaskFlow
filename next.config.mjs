/** @type {import('next').NextConfig} */
const nextConfig = {
    images: {
        remotePatterns: [
            {
                protocol: "https",
                hostname: "lh3.googleusercontent.com",
            },
            {
                protocol: "https",
                hostname: "pbs.twimg.com",
            }
        ],
    },
    // The app had no response headers at all. Two of these are load-bearing
    // rather than hardening: `frame-ancestors` blocks a hostile page from
    // iframing the login and signup forms to overlay an invisible credential
    // form, and `no-referrer` keeps the one-time token in /reset-password?token=
    // out of the Referer header sent to any third-party origin the page loads.
    async headers() {
        return [
            {
                source: "/:path*",
                headers: [
                    { key: "X-Content-Type-Options", value: "nosniff" },
                    { key: "X-Frame-Options", value: "DENY" },
                    {
                        key: "Content-Security-Policy",
                        // `frame-ancestors` supersedes X-Frame-Options for
                        // modern browsers and is the only spelling that works
                        // in a CSP. Left off `default-src` deliberately: this app
                        // loads avatar images and inline styles from Next, and a
                        // default-src here would break rendering for a benefit
                        // frame-ancestors already provides on its own.
                        value: "frame-ancestors 'none'",
                    },
                    { key: "Referrer-Policy", value: "no-referrer" },
                    {
                        key: "Strict-Transport-Security",
                        value: "max-age=63072000; includeSubDomains",
                    },
                    {
                        key: "Permissions-Policy",
                        value: "camera=(), microphone=(), geolocation=()",
                    },
                ],
            },
        ];
    },
};

export default nextConfig;