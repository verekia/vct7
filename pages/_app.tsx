import Head from 'next/head'

import type { AppProps } from 'next/app'
import '../global.css'

const App = ({ Component, pageProps }: AppProps) => (
  <>
    <Head>
      <title>VCT7</title>
    </Head>
    <Component {...pageProps} />
  </>
)

export default App
